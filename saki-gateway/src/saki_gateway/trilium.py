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

    def update_note_content(self, note_id: str, content: str) -> bool:
        if not self.enabled or not str(note_id).strip():
            return False
        safe_id = urllib.parse.quote(str(note_id), safe="")
        payload = self._request_text(
            "PUT",
            f"/etapi/notes/{safe_id}/content",
            body=str(content or "").encode("utf-8"),
            headers={"Content-Type": "text/plain; charset=utf-8"},
        )
        return payload is not None

    def create_note(
        self,
        *,
        parent_note_id: str,
        title: str,
        content: str,
    ) -> Optional[Dict[str, Any]]:
        if not self.enabled or not str(parent_note_id).strip() or not str(title).strip():
            return None
        payload = {
            "parentNoteId": str(parent_note_id),
            "title": str(title),
            "type": "text",
            "mime": "text/markdown",
            "content": str(content or ""),
        }
        result = self._request_json("POST", "/etapi/create-note", body=payload)
        return result if isinstance(result, dict) else None

    def upsert_note_by_path(
        self,
        *,
        path_titles: List[str],
        note_title: str,
        content: str,
    ) -> Dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "status": "trilium_unavailable", "note_id": "", "reason": "disabled"}
        parent_id = "root"
        for title in path_titles:
            candidates = self.search_notes(title, limit=10, parent_note_id=parent_id)
            matched = next((item for item in candidates if str(item.get("title", "") or "") == title), None)
            if matched is None:
                created = self.create_note(parent_note_id=parent_id, title=title, content=f"# {title}\n")
                if not created:
                    return {"ok": False, "status": "write_failed", "note_id": "", "reason": f"failed to create folder note: {title}"}
                parent_id = str(created.get("noteId", "") or created.get("note_id", "") or "")
            else:
                parent_id = str(matched.get("noteId", "") or matched.get("note_id", "") or "")
            if not parent_id:
                return {"ok": False, "status": "write_failed", "note_id": "", "reason": f"invalid parent note id for: {title}"}
        candidates = self.search_notes(note_title, limit=10, parent_note_id=parent_id)
        matched = next((item for item in candidates if str(item.get("title", "") or "") == note_title), None)
        if matched is not None:
            note_id = str(matched.get("noteId", "") or matched.get("note_id", "") or "")
            if not note_id:
                return {"ok": False, "status": "write_failed", "note_id": "", "reason": "missing matched note id"}
            if not self.update_note_content(note_id, content):
                return {"ok": False, "status": "write_failed", "note_id": note_id, "reason": "failed to update note content"}
            return {"ok": True, "status": "updated", "note_id": note_id}
        created = self.create_note(parent_note_id=parent_id, title=note_title, content=content)
        if not created:
            return {"ok": False, "status": "write_failed", "note_id": "", "reason": "failed to create digest note"}
        note_id = str(created.get("noteId", "") or created.get("note_id", "") or "")
        return {"ok": True, "status": "created", "note_id": note_id}

    def _request_json(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Optional[Any]:
        body_bytes = None
        merged_headers = dict(headers or {})
        if body is not None:
            body_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")
            merged_headers.setdefault("Content-Type", "application/json; charset=utf-8")
        raw = self._request_text(method, path, params=params, body=body_bytes, headers=merged_headers)
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
        body: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Optional[str]:
        if not self.enabled:
            return None
        base_url = str(self.config.url or "").rstrip("/")
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        target = f"{base_url}{path}{query}"
        request_headers = {
            "Authorization": str(self.config.token or ""),
            "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
            "User-Agent": "saki-gateway/0.1",
        }
        request_headers.update(headers or {})
        request = urllib.request.Request(
            target,
            data=body,
            method=method,
            headers=request_headers,
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
