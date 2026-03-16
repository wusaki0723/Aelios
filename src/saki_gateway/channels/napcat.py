from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, Optional


NapcatEventHandler = Callable[[Dict[str, Any]], Iterable[str]]


@dataclass
class NapcatChannelConfig:
    base_url: str
    access_token: str = ""
    enabled: bool = False
    send_chunk_chars: int = 1600
    dedupe_ttl_seconds: int = 3600


@dataclass
class NapcatInboundMessage:
    message_id: str
    user_id: str
    group_id: str = ""
    raw_message: Any = None
    text: str = ""
    message_type: str = "private"
    sub_type: str = ""
    sender_nickname: str = ""
    raw: Optional[dict[str, Any]] = None


class NapcatChannel:
    def __init__(self, config: NapcatChannelConfig):
        self.config = config
        self._event_handler: Optional[NapcatEventHandler] = None
        self._ready = False
        self._last_error = ""
        self._recent_messages: "OrderedDict[str, float]" = OrderedDict()
        self._recent_lock = threading.Lock()

    def start(self, event_handler: NapcatEventHandler) -> None:
        if not self.config.enabled:
            return
        if not self.config.base_url:
            raise ValueError("napcat base_url is required")
        self._event_handler = event_handler
        self._probe()

    def stop(self) -> None:
        self._ready = False
        self._last_error = "stopped"
        self._event_handler = None

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "mode": "http-webhook",
            "ready": self._ready,
            "note": self._status_note(),
            "base_url": self.config.base_url,
        }

    def handle_event(self, payload: Dict[str, Any]) -> None:
        normalized = self._normalize_inbound(payload)
        if normalized is None:
            return
        if self._event_handler is None:
            return
        try:
            chunks = self._event_handler(
                {
                    "channel": "qq",
                    "message_id": normalized.message_id,
                    "user_id": normalized.user_id,
                    "group_id": normalized.group_id,
                    "message_type": normalized.message_type,
                    "sub_type": normalized.sub_type,
                    "text": normalized.text,
                    "sender_nickname": normalized.sender_nickname,
                }
            )
            final_text = "".join(chunk for chunk in chunks if chunk)
            if final_text.strip():
                self.send_text(
                    normalized.user_id,
                    final_text,
                    group_id=normalized.group_id,
                    message_type=normalized.message_type,
                    reply_to=normalized.message_id,
                )
        except Exception as error:
            self._last_error = str(error)
            fallback = f"这边刚刚出了点问题：{error}"
            self.send_text(
                normalized.user_id,
                fallback,
                group_id=normalized.group_id,
                message_type=normalized.message_type,
                reply_to=normalized.message_id,
            )

    def send_text(
        self,
        user_id: str,
        content: str,
        *,
        group_id: str = "",
        message_type: str = "private",
        reply_to: str = "",
    ) -> None:
        target_group = group_id.strip()
        if target_group or message_type == "group":
            self._send_group_text(target_group or user_id, content, reply_to=reply_to)
            return
        self._send_private_text(user_id, content, reply_to=reply_to)

    def _probe(self) -> None:
        try:
            self._call_action("get_login_info", {})
            self._ready = True
            self._last_error = ""
        except Exception as error:
            self._ready = False
            self._last_error = str(error)
            raise

    def _call_action(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        base = self.config.base_url.rstrip("/")
        url = f"{base}/{action}"
        data = json.dumps(params, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "aelios-gateway/0.1",
        }
        token = self.config.access_token.strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise ValueError(f"napcat action {action} failed: {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise ValueError(f"napcat action {action} failed: {error}") from error
        if int(payload.get("retcode", 0) or 0) != 0:
            raise ValueError(f"napcat action {action} failed: {payload}")
        return payload

    def _send_private_text(self, user_id: str, content: str, *, reply_to: str = "") -> None:
        for chunk in self._chunk_text(content):
            message = self._compose_message_segments(chunk, reply_to)
            self._call_action("send_private_msg", {"user_id": int(user_id), "message": message})

    def _send_group_text(self, group_id: str, content: str, *, reply_to: str = "") -> None:
        for chunk in self._chunk_text(content):
            message = self._compose_message_segments(chunk, reply_to)
            self._call_action("send_group_msg", {"group_id": int(group_id), "message": message})

    def _compose_message_segments(self, content: str, reply_to: str) -> list[Dict[str, Any]]:
        segments: list[Dict[str, Any]] = []
        if reply_to:
            segments.append({"type": "reply", "data": {"id": str(reply_to)}})
        segments.append({"type": "text", "data": {"text": content}})
        return segments

    def _chunk_text(self, content: str) -> list[str]:
        text = content.strip() or "[空回复]"
        size = max(200, self.config.send_chunk_chars)
        return [text[i : i + size] for i in range(0, len(text), size)] or [text]

    def _normalize_inbound(self, payload: Dict[str, Any]) -> Optional[NapcatInboundMessage]:
        post_type = str(payload.get("post_type", "") or "")
        if post_type != "message":
            return None
        message_id = str(payload.get("message_id", "") or "")
        if not message_id or self._seen_recently(message_id):
            return None
        user_id = str(payload.get("user_id", "") or "")
        group_id = str(payload.get("group_id", "") or "")
        message_type = str(payload.get("message_type", "private") or "private")
        sub_type = str(payload.get("sub_type", "") or "")
        sender = payload.get("sender") or {}
        nickname = str(sender.get("card", "") or sender.get("nickname", "") or "")
        text = self._extract_message_text(payload.get("message"))
        if not text.strip():
            text = "[暂不支持直接解析的 QQ 消息类型]"
        return NapcatInboundMessage(
            message_id=message_id,
            user_id=user_id,
            group_id=group_id,
            text=text,
            message_type=message_type,
            sub_type=sub_type,
            sender_nickname=nickname,
            raw=payload,
        )

    def _extract_message_text(self, message: Any) -> str:
        if isinstance(message, str):
            return message
        if isinstance(message, list):
            parts: list[str] = []
            for segment in message:
                if not isinstance(segment, dict):
                    continue
                if str(segment.get("type", "")) != "text":
                    continue
                data = segment.get("data") or {}
                parts.append(str(data.get("text", "") or ""))
            return "".join(parts)
        if isinstance(message, dict):
            data = message.get("data") or {}
            return str(data.get("text", "") or "")
        return ""

    def _seen_recently(self, message_id: str) -> bool:
        now = time.time()
        with self._recent_lock:
            if message_id in self._recent_messages:
                self._recent_messages.move_to_end(message_id)
                return True
            self._recent_messages[message_id] = now
            while self._recent_messages:
                oldest_id, oldest_at = next(iter(self._recent_messages.items()))
                if now - oldest_at <= self.config.dedupe_ttl_seconds:
                    break
                self._recent_messages.popitem(last=False)
            return False

    def _status_note(self) -> str:
        if self._last_error:
            return self._last_error
        if self._ready:
            return "connected"
        return "idle"
