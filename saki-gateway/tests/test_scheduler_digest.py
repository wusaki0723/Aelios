from __future__ import annotations

from datetime import datetime
import unittest

from saki_gateway.config import SchedulerConfig
from saki_gateway.scheduler import GatewayScheduler


class _StoreStub:
    def list_due_reminders(self, limit: int = 10):
        return []

    def list_inactive_profiles(self, **kwargs):
        return []


class SchedulerDigestTests(unittest.TestCase):
    def _make_scheduler(self, callback):
        config = SchedulerConfig(enabled=True, poll_interval_seconds=10, local_timezone="Asia/Shanghai")
        return GatewayScheduler(
            _StoreStub(),
            lambda: config,
            on_due_reminder=lambda _rid: None,
            on_proactive_ping=lambda _pid: None,
            on_memory_digest=callback,
        )

    def test_digest_runs_once_per_local_date_after_0405(self) -> None:
        calls = {"count": 0}

        def callback() -> bool:
            calls["count"] += 1
            return True

        scheduler = self._make_scheduler(callback)
        scheduler._scheduler_now = lambda _tz: datetime(2026, 1, 2, 4, 5, 0)

        scheduler._run_memory_digest()
        scheduler._run_memory_digest()

        self.assertEqual(calls["count"], 1)

    def test_digest_skips_before_0405(self) -> None:
        calls = {"count": 0}

        scheduler = self._make_scheduler(lambda: calls.__setitem__("count", calls["count"] + 1) or True)
        scheduler._scheduler_now = lambda _tz: datetime(2026, 1, 2, 4, 4, 0)

        scheduler._run_memory_digest()

        self.assertEqual(calls["count"], 0)

    def test_digest_retries_when_callback_reports_failure(self) -> None:
        calls = {"count": 0}

        def callback() -> bool:
            calls["count"] += 1
            return calls["count"] >= 2

        scheduler = self._make_scheduler(callback)
        scheduler._scheduler_now = lambda _tz: datetime(2026, 1, 2, 4, 7, 0)

        scheduler._run_memory_digest()
        scheduler._run_memory_digest()

        self.assertEqual(calls["count"], 2)


if __name__ == "__main__":
    unittest.main()
