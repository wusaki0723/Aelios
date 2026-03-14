from __future__ import annotations

import unittest

from saki_gateway.server import GatewayApp


class _ToolListStub:
    def list_enabled(self):
        return [
            {"id": "search_trilium", "description": "", "schema": {}},
            {"id": "get_trilium_note", "description": "", "schema": {}},
            {"id": "search_web", "description": "", "schema": {}},
        ]


class TriliumServerSafeguardTests(unittest.TestCase):
    def _make_app(self) -> GatewayApp:
        app = GatewayApp.__new__(GatewayApp)
        app.tools = _ToolListStub()
        return app

    def test_chat_tool_specs_skip_trilium_for_ordinary_chat(self) -> None:
        app = self._make_app()
        specs = app._chat_tool_specs(
            "local-user", [{"role": "user", "content": "今天天气怎么样"}]
        )
        names = {item["function"]["name"] for item in specs}
        self.assertIn("search_web", names)
        self.assertNotIn("search_trilium", names)
        self.assertNotIn("get_trilium_note", names)

    def test_chat_tool_specs_include_trilium_for_note_intent(self) -> None:
        app = self._make_app()
        specs = app._chat_tool_specs(
            "local-user", [{"role": "user", "content": "帮我找一下我的学习笔记"}]
        )
        names = {item["function"]["name"] for item in specs}
        self.assertIn("search_trilium", names)
        self.assertIn("get_trilium_note", names)

    def test_compact_search_context_distinguishes_unavailable_and_empty(self) -> None:
        app = self._make_app()
        unavailable = app._compact_trilium_search_context(
            "python", {"ok": False, "status": "trilium_unavailable", "items": []}
        )
        empty = app._compact_trilium_search_context(
            "python", {"ok": True, "status": "no_notes_found", "items": []}
        )
        self.assertIn("不可用", unavailable)
        self.assertIn("未找到", empty)

    def test_compact_note_context_truncates(self) -> None:
        app = self._make_app()
        long_content = "A" * 2000
        context = app._compact_trilium_note_context(
            {
                "ok": True,
                "status": "ok",
                "note": {"title": "Long Note"},
                "content": long_content,
            }
        )
        self.assertIn("Long Note", context)
        self.assertIn("已截断", context)
        self.assertLess(len(context), 1000)


if __name__ == "__main__":
    unittest.main()
