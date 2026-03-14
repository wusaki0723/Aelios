from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .config import TriliumConfig


LOGGER = logging.getLogger(__name__)


class TriliumClient:
    def __init__(self, config: TriliumConfig):
        self.config = config

    @property
    def enabled(self) -> bool:
        return bool(
            self.config.enabled
            and str(self.config.url or "").strip()
            and str(self.config.token or "").strip()
        )

    def health_check(self) -> Dict[str, Any]:
        if not self.config.enabled:
            return {
                "ok": False,
                "status": "disabled",
                "detail": "trilium integration disabled",
            }
        if not self.enabled:
            return {
                "ok": False,
                "status": "misconfigured",
                "detail": "missing trilium url or token",
            }
        result = self._request_json("GET", "/etapi/app-info")
        if result is None:
            return {
                "ok": False,
                "status": "unavailable",
                "detail": "trilium service is unreachable",
            }
        return {"ok": True, "status": "ok", "detail": "trilium service reachable"}

    def search_notes(
        self,
        query: str,
        limit: int = 5,
        parent_note_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not self.enabled:
            return []
        normalized_limit = max(1, min(int(limit or 5), 30))
        params: Dict[str, Any] = {"search": query, "limit": normalized_limit}
        if parent_note_id:
            params["parentNoteId"] = parent_note_id
        payload = self._request_json("GET", "/etapi/notes", params=params)
        if payload is None:
            return []
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            items = payload.get("results") or payload.get("items") or []
            return [item for item in items if isinstance(item, dict)]
        return []

    def get_note(self, note_id: str) -> Optional[Dict[str, Any]]:
        if not self.enabled or not str(note_id).strip():
            return None
        safe_id = urllib.parse.quote(str(note_id), safe="")
        payload = self._request_json("GET", f"/etapi/notes/{safe_id}")
        if isinstance(payload, dict):
            return payload
        return None

    def get_note_content(self, note_id: str) -> str:
        if not self.enabled or not str(note_id).strip():
            return ""
        safe_id = urllib.parse.quote(str(note_id), safe="")
        payload = self._request_text("GET", f"/etapi/notes/{safe_id}/content")
        return payload or ""

    def list_children(self, parent_note_id: str) -> List[Dict[str, Any]]:
        if not self.enabled or not str(parent_note_id).strip():
            return []
        safe_id = urllib.parse.quote(str(parent_note_id), safe="")
        payload = self._request_json("GET", f"/etapi/notes/{safe_id}/children")
        if payload is None:
            return []
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            items = payload.get("children") or payload.get("items") or []
            return [item for item in items if isinstance(item, dict)]
        return []

    def _request_json(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        raw = self._request_text(method, path, params=params)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            LOGGER.warning("trilium returned invalid json for path=%s", path)
            return None

    def _request_text(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        if not self.enabled:
            return None
        base_url = str(self.config.url or "").rstrip("/")
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        target = f"{base_url}{path}{query}"
        request = urllib.request.Request(
            target,
            method=method,
            headers={
                "Authorization": str(self.config.token or ""),
                "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
                "User-Agent": "saki-gateway/0.1",
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=max(1, int(self.config.timeout_seconds or 10)),
            ) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as error:
            LOGGER.warning("trilium request failed path=%s error=%s", path, error)
            return None
