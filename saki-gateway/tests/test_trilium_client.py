from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from saki_gateway.config import TriliumConfig
from saki_gateway.trilium import TriliumClient


class _FakeResponse:
    def __init__(self, payload: str):
        self._payload = payload.encode("utf-8")

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class TriliumClientTests(unittest.TestCase):
    def test_health_check_disabled(self) -> None:
        client = TriliumClient(TriliumConfig(enabled=False))
        result = client.health_check()
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "disabled")

    @patch("urllib.request.urlopen")
    def test_health_check_ok(self, mock_urlopen) -> None:
        mock_urlopen.return_value = _FakeResponse(json.dumps({"appVersion": "0.1"}))
        client = TriliumClient(
            TriliumConfig(enabled=True, url="http://localhost:8080", token="secret")
        )
        result = client.health_check()
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "ok")

    @patch("urllib.request.urlopen", side_effect=OSError("down"))
    def test_search_notes_fails_gracefully(self, _mock_urlopen) -> None:
        client = TriliumClient(
            TriliumConfig(enabled=True, url="http://localhost:8080", token="secret")
        )
        self.assertEqual(client.search_notes("diary"), [])

    @patch("urllib.request.urlopen")
    def test_getters_success(self, mock_urlopen) -> None:
        mock_urlopen.side_effect = [
            _FakeResponse(json.dumps({"noteId": "n1", "title": "A"})),
            _FakeResponse("# note content"),
            _FakeResponse(json.dumps({"children": [{"noteId": "n2"}]})),
        ]
        client = TriliumClient(
            TriliumConfig(enabled=True, url="http://localhost:8080", token="secret")
        )
        note = client.get_note("n1")
        content = client.get_note_content("n1")
        children = client.list_children("n1")
        self.assertEqual(note["noteId"], "n1")
        self.assertEqual(content, "# note content")
        self.assertEqual(children[0]["noteId"], "n2")


if __name__ == "__main__":
    unittest.main()
