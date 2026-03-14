from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from saki_gateway.config import AppConfig, _apply_env_overrides
from saki_gateway.tools import build_default_registry


class _FakeTriliumClient:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled

    def health_check(self):
        return {"ok": True, "status": "ok", "detail": "ready"}

    def search_notes(self, query: str, limit: int = 5, parent_note_id: str | None = None):
        return [{"noteId": "note-1", "title": f"{query}-result"}]

    def get_note(self, note_id: str):
        return {"noteId": note_id, "title": "Diary"}

    def get_note_content(self, note_id: str):
        return "diary content"


class TriliumIntegrationTests(unittest.TestCase):
    def test_env_prefers_etapi_token(self) -> None:
        with patch.dict(
            os.environ,
            {
                "TRILIUM_ENABLED": "true",
                "TRILIUM_TOKEN": "legacy-token",
                "TRILIUM_ETAPI_TOKEN": "etapi-token",
                "TRILIUM_URL": "http://trilium.local",
            },
            clear=False,
        ):
            cfg = _apply_env_overrides(AppConfig())
        self.assertTrue(cfg.trilium.enabled)
        self.assertEqual(cfg.trilium.token, "etapi-token")

    def test_registry_exposes_trilium_tools_when_enabled(self) -> None:
        config = AppConfig()
        config.trilium.enabled = True
        config.trilium.url = "http://trilium.local"
        config.trilium.token = "token"
        registry = build_default_registry(
            Path.cwd(),
            lambda: config,
            trilium_client=_FakeTriliumClient(enabled=True),
        )
        tool_ids = {item["id"] for item in registry.list_enabled()}
        self.assertIn("search_trilium", tool_ids)
        self.assertIn("get_trilium_note", tool_ids)

        search_result = registry.execute("search_trilium", {"query": "study"})
        self.assertTrue(search_result["ok"])
        self.assertEqual(search_result["items"][0]["noteId"], "note-1")

        note_result = registry.execute("get_trilium_note", {"note_id": "note-1"})
        self.assertTrue(note_result["ok"])
        self.assertEqual(note_result["content"], "diary content")


if __name__ == "__main__":
    unittest.main()
