from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from saki_gateway.memory import MemoryStore
from saki_gateway.server import GatewayApp


class CoreUpdateProposalTests(unittest.TestCase):
    def _make_store(self) -> MemoryStore:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        db_path = Path(temp_dir.name) / "memories.db"
        return MemoryStore(db_path)

    def _make_app(self) -> GatewayApp:
        app = GatewayApp.__new__(GatewayApp)
        app.memory_store = self._make_store()
        app._events = []
        app.record_event = lambda event_type, payload: app._events.append((event_type, payload))
        app._write_text_file = lambda _path, _content: None
        app._core_memory_file = lambda: Path("/tmp/core_profile.md")
        app.config_store = SimpleNamespace(
            config=SimpleNamespace(
                persona=SimpleNamespace(
                    partner_name="Aelios",
                    partner_role="AI 伴侣",
                    call_user="你",
                    core_identity="温柔",
                    boundaries="不生硬",
                )
            )
        )
        app.list_memories_grouped = lambda: {"items": []}
        return app

    def test_invalid_target_section_rejected(self) -> None:
        app = self._make_app()
        result = app._create_core_update_proposal(
            target_section="Unknown",
            proposed_content="hello",
            reason="test",
            source_context="ctx",
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "invalid_target_section")

    def test_duplicate_open_is_suppressed_for_whitespace_only_diff(self) -> None:
        app = self._make_app()
        first = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="用户喜欢  周末   徒步",
            reason="digest",
            source_context="ctx-a",
            proposal_type="preference",
            confidence="high",
        )
        second = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="用户喜欢 周末 徒步",
            reason="digest",
            source_context="ctx-b",
            proposal_type="preference",
            confidence="high",
        )
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["proposal_id"], second["proposal_id"])
        self.assertEqual(len(app.memory_store.list_core_updates(status="open", limit=10)), 1)

    def test_meaningfully_different_content_creates_new(self) -> None:
        app = self._make_app()
        first = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="用户喜欢周末徒步",
            reason="digest",
            source_context="ctx-a",
        )
        second = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="用户喜欢周末徒步和夜跑",
            reason="digest",
            source_context="ctx-b",
        )
        self.assertNotEqual(first["proposal_id"], second["proposal_id"])

    def test_proposal_type_and_confidence_are_saved(self) -> None:
        app = self._make_app()
        proposal = app._create_core_update_proposal(
            target_section="Relationship Core",
            proposed_content="每周安排约会",
            reason="digest",
            source_context="ctx",
            proposal_type="relationship",
            confidence="high",
        )
        row = app.memory_store.get_core_update(proposal["proposal_id"])
        self.assertEqual(row.proposal_type, "relationship")
        self.assertEqual(row.confidence, "high")

    def test_new_approved_content_merged_once_into_correct_section(self) -> None:
        app = self._make_app()
        proposal = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="偏好: 周末徒步",
            reason="digest",
            source_context="ctx",
            proposal_type="preference",
            confidence="medium",
        )
        result = app.approve_core_update_proposal(proposal["proposal_id"])
        self.assertTrue(result["ok"])
        record = app.memory_store.get_memory("core_section::my_profile")
        self.assertIsNotNone(record)
        self.assertIn("- 偏好: 周末徒步", record.content)

    def test_duplicate_approved_content_not_appended_twice(self) -> None:
        app = self._make_app()
        first = app._create_core_update_proposal(
            target_section="Relationship Core",
            proposed_content="约定: 每周五晚散步",
            reason="digest",
            source_context="ctx1",
            proposal_type="relationship",
            confidence="high",
        )
        app.approve_core_update_proposal(first["proposal_id"])

        second = app._create_core_update_proposal(
            target_section="Relationship Core",
            proposed_content="约定: 每周五晚散步",
            reason="digest",
            source_context="ctx2",
            proposal_type="relationship",
            confidence="high",
        )
        app.approve_core_update_proposal(second["proposal_id"])

        record = app.memory_store.get_memory("core_section::relationship_core")
        self.assertEqual(record.content.count("约定: 每周五晚散步"), 1)

    def test_conflicting_content_handled_conservatively(self) -> None:
        app = self._make_app()
        first = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="起床时间: 07:00",
            reason="digest",
            source_context="ctx-a",
            proposal_type="routine",
            confidence="medium",
        )
        app.approve_core_update_proposal(first["proposal_id"])

        second = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="起床时间: 09:30",
            reason="digest",
            source_context="ctx-b",
            proposal_type="routine",
            confidence="medium",
        )
        app.approve_core_update_proposal(second["proposal_id"])

        record = app.memory_store.get_memory("core_section::my_profile")
        self.assertIn("起床时间: 07:00", record.content)
        self.assertNotIn("起床时间: 09:30", record.content)

    def test_reject_preserves_core_profile_storage(self) -> None:
        app = self._make_app()
        proposal = app._create_core_update_proposal(
            target_section="My Profile",
            proposed_content="用户偏好早睡",
            reason="digest",
            source_context="ctx",
        )
        before = app.memory_store.get_memory("core_section::my_profile")
        result = app.reject_core_update_proposal(proposal["proposal_id"])
        after = app.memory_store.get_memory("core_section::my_profile")
        self.assertTrue(result["ok"])
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
