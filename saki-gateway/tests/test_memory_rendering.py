from __future__ import annotations

import unittest
from types import SimpleNamespace

from saki_gateway.server import GatewayApp


class _MemoryStoreStub:
    def __init__(self, records):
        self._records = records

    def list_memories(self, limit=20, memory_kind="long_term"):
        return self._records[:limit]


class MemoryRenderingTests(unittest.TestCase):
    def _make_app(self, grouped_items=None, records=None) -> GatewayApp:
        app = GatewayApp.__new__(GatewayApp)
        app.config_store = SimpleNamespace(
            config=SimpleNamespace(
                persona=SimpleNamespace(
                    partner_name="Aelios",
                    partner_role="AI 伴侣",
                    call_user="宝贝",
                    core_identity="温柔而坚定",
                    boundaries="不使用生硬客服口吻",
                )
            )
        )
        app.memory_store = _MemoryStoreStub(records or [])
        app.list_memories_grouped = lambda: {"items": grouped_items or []}
        return app

    def test_render_core_profile_uses_structured_sections(self) -> None:
        app = self._make_app(
            grouped_items=[
                {
                    "category": "preference",
                    "title": "咖啡偏好",
                    "content": "喜欢拿铁，不加糖。",
                }
            ]
        )

        content = app._render_core_profile()

        self.assertIn("格式版本: core_profile.v2", content)
        self.assertIn("## About Her", content)
        self.assertIn("## Relationship Core", content)
        self.assertIn("## My Profile", content)
        self.assertIn("[preference] 咖啡偏好", content)

    def test_render_active_memory_uses_structured_sections(self) -> None:
        record = SimpleNamespace(
            category="promise",
            key="周末散步",
            content="本周末一起去公园散步并拍照。",
        )
        app = self._make_app(records=[record])

        content = app._render_active_memory()

        self.assertIn("格式版本: active_memory.v2", content)
        self.assertIn("## Current Status", content)
        self.assertIn("## Purpose Context", content)
        self.assertIn("## On the Horizon", content)
        self.assertIn("## Others", content)
        self.assertIn("待跟进线索: 周末散步", content)

    def test_render_active_memory_truncates_long_items(self) -> None:
        long_text = "A" * 400
        record = SimpleNamespace(category="relationship", key="长文本", content=long_text)
        app = self._make_app(records=[record])

        content = app._render_active_memory()

        self.assertIn("…", content)
        self.assertNotIn(long_text, content)


if __name__ == "__main__":
    unittest.main()
