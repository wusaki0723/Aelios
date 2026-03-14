from __future__ import annotations

from datetime import datetime
import unittest

from saki_gateway.server import GatewayApp


class DigestExecutionTests(unittest.TestCase):
    def _make_app(self):
        app = GatewayApp.__new__(GatewayApp)
        state = {
            "id": "",
            "run_state": "idle",
            "status": "not_started",
            "started_at": "",
            "completed_at": "",
            "error_message": "",
        }
        app._digest_state = state
        app._events = []
        app._upsert_calls = 0

        app._now_in_local_timezone = lambda: datetime(2026, 1, 2, 4, 10, 0)
        app._read_digest_run_state = lambda: dict(app._digest_state)
        app._write_digest_run_state = lambda payload: app._digest_state.update(payload)
        app._build_nightly_digest_payload = lambda now: {
            "window_start": "2026-01-01T20:10:00+00:00",
            "window_end": "2026-01-02T20:10:00+00:00",
            "messages": [],
            "events": [],
            "active_memory": "",
            "durable_memory_lines": [],
        }
        app._generate_nightly_digest_summary = lambda payload: "- summary"
        app._render_nightly_digest_markdown = lambda **kwargs: "# digest\n"
        app._refresh_active_memory = lambda: None
        app.record_event = lambda event_type, payload: app._events.append((event_type, payload))
        return app

    def test_idempotent_skip_after_success_same_date(self) -> None:
        app = self._make_app()

        def upsert_ok(*, local_date: str, content: str):
            app._upsert_calls += 1
            return {"ok": True, "note_id": "note-1", "status": "updated"}

        app._upsert_trilium_daily_digest = upsert_ok

        first = GatewayApp._run_scheduled_nightly_digest(app)
        second = GatewayApp._run_scheduled_nightly_digest(app)

        self.assertTrue(first)
        self.assertTrue(second)
        self.assertEqual(app._upsert_calls, 1)
        self.assertEqual(app._digest_state["status"], "success")

    def test_retry_safe_after_failure(self) -> None:
        app = self._make_app()

        def upsert_flaky(*, local_date: str, content: str):
            app._upsert_calls += 1
            if app._upsert_calls == 1:
                return {"ok": False, "status": "trilium_unavailable", "reason": "down"}
            return {"ok": True, "note_id": "note-2", "status": "created"}

        app._upsert_trilium_daily_digest = upsert_flaky

        first = GatewayApp._run_scheduled_nightly_digest(app)
        self.assertFalse(first)
        self.assertEqual(app._digest_state["status"], "failed")

        second = GatewayApp._run_scheduled_nightly_digest(app)
        self.assertTrue(second)
        self.assertEqual(app._digest_state["status"], "success")
        self.assertEqual(app._upsert_calls, 2)


if __name__ == "__main__":
    unittest.main()
