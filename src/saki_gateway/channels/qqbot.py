from __future__ import annotations

import asyncio
import base64
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional

import websockets
from nacl.signing import SigningKey


QqbotEventHandler = Callable[[Dict[str, Any]], Iterable[str]]

QQBOT_API_BASE = "https://api.sgroup.qq.com"
QQBOT_ACCESS_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"
INTENT_GROUP_AND_C2C = 1 << 25


@dataclass
class QQBotChannelConfig:
    app_id: str
    token: str
    enabled: bool = False
    send_chunk_chars: int = 1600
    dedupe_ttl_seconds: int = 3600
    webhook_path: str = "/api/channels/qq/inbound"
    webhook_secret: str = ""
    callback_base_url: str = ""
    data_dir: str = ""


@dataclass
class QQBotInboundMessage:
    message_id: str
    user_id: str
    group_id: str = ""
    text: str = ""
    message_type: str = "private"
    sub_type: str = ""
    sender_nickname: str = ""
    attachments: list[dict[str, Any]] = field(default_factory=list)
    raw: Optional[dict[str, Any]] = None


class QQBotChannel:
    def __init__(self, config: QQBotChannelConfig):
        self.config = config
        self._event_handler: Optional[QqbotEventHandler] = None
        self._ready = False
        self._last_error = ""
        self._recent_messages: "OrderedDict[str, float]" = OrderedDict()
        self._recent_lock = threading.Lock()
        self._gateway_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._gateway_loop_ref: Optional[asyncio.AbstractEventLoop] = None
        self._gateway_ws: Any = None
        self._gateway_seq: Optional[int] = None
        self._gateway_session_id = ""
        self._access_token = ""
        self._access_token_expire_at = 0.0
        self._token_lock = threading.Lock()

    def start(self, event_handler: QqbotEventHandler) -> None:
        if not self.config.enabled:
            return
        if not self.config.app_id or not self.config.token:
            raise ValueError("qqbot app_id and token are required")
        self._event_handler = event_handler
        self._stop_event.clear()
        self._probe()
        self._start_gateway_loop()

    def stop(self) -> None:
        self._stop_event.set()
        self._ready = False
        self._last_error = "stopped"
        if self._gateway_loop_ref is not None:
            try:
                self._gateway_loop_ref.call_soon_threadsafe(lambda: None)
            except Exception:
                pass
        if self._gateway_thread and self._gateway_thread.is_alive():
            self._gateway_thread.join(timeout=5)
        self._gateway_ws = None
        self._gateway_loop_ref = None
        self._gateway_thread = None
        self._event_handler = None

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "mode": "official-websocket",
            "ready": self._ready,
            "note": self._status_note(),
            "app_id": self.config.app_id,
        }

    def handle_event(self, payload: Dict[str, Any]) -> None:
        op = int(payload.get("op", 0) or 0)
        if op == 13:
            return
        normalized = self._normalize_inbound(payload)
        if normalized is None:
            return
        self._dispatch_inbound(normalized)

    def validation_response(self, payload: Dict[str, Any]) -> Dict[str, str]:
        data = payload.get("d") or {}
        plain_token = str(data.get("plain_token", "") or "")
        event_ts = str(data.get("event_ts", "") or "")
        if not plain_token or not event_ts:
            raise ValueError("invalid qqbot validation payload")
        seed = self.config.token
        while len(seed) < 32:
            seed += seed
        seed = seed[:32].encode("utf-8")
        signing_key = SigningKey(seed)
        signature = signing_key.sign(
            f"{event_ts}{plain_token}".encode("utf-8")
        ).signature.hex()
        return {"plain_token": plain_token, "signature": signature}

    def send_text(
        self,
        user_id: str,
        content: str,
        *,
        group_id: str = "",
        message_type: str = "private",
        reply_to: str = "",
        attachments: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        text = (content or "").strip()
        image_items, file_items = self._extract_outbound_media(attachments or [])
        target_group = group_id.strip()
        if image_items:
            for image in image_items:
                if target_group or message_type == "group":
                    self._send_group_image(
                        target_group or user_id, image, reply_to=reply_to
                    )
                else:
                    self._send_c2c_image(user_id, image, reply_to=reply_to)
            reply_to = ""
        if file_items:
            for file_item in file_items:
                if target_group or message_type == "group":
                    self._send_group_file(
                        target_group or user_id, file_item, reply_to=reply_to
                    )
                else:
                    self._send_c2c_file(user_id, file_item, reply_to=reply_to)
            reply_to = ""
        if not text:
            return
        if target_group or message_type == "group":
            self._send_group_text(target_group or user_id, text, reply_to=reply_to)
            return
        self._send_private_text(user_id, text, reply_to=reply_to)

    def _dispatch_inbound(self, normalized: QQBotInboundMessage) -> None:
        if self._event_handler is None:
            return
        try:
            chunks = self._event_handler(
                {
                    "channel": "qqbot",
                    "message_id": normalized.message_id,
                    "user_id": normalized.user_id,
                    "group_id": normalized.group_id,
                    "message_type": normalized.message_type,
                    "sub_type": normalized.sub_type,
                    "text": normalized.text,
                    "sender_nickname": normalized.sender_nickname,
                    "attachments": normalized.attachments,
                }
            )
            final_text = "".join(chunk for chunk in chunks if chunk)
            if final_text.strip() or normalized.attachments:
                self.send_text(
                    normalized.user_id,
                    final_text,
                    group_id=normalized.group_id,
                    message_type=normalized.message_type,
                    reply_to="",
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

    def _probe(self) -> None:
        try:
            self._get_gateway_url()
            self._ready = True
            self._last_error = ""
        except Exception as error:
            self._ready = False
            self._last_error = str(error)
            raise

    def _start_gateway_loop(self) -> None:
        if self._gateway_thread and self._gateway_thread.is_alive():
            return
        self._gateway_thread = threading.Thread(
            target=self._gateway_loop_worker,
            name="qqbot-gateway",
            daemon=True,
        )
        self._gateway_thread.start()

    def _gateway_loop_worker(self) -> None:
        self._gateway_loop_ref = asyncio.new_event_loop()
        asyncio.set_event_loop(self._gateway_loop_ref)
        try:
            self._gateway_loop_ref.run_until_complete(self._gateway_loop_async())
        except BaseException as error:
            self._ready = False
            self._last_error = f"qqbot gateway worker stopped: {error}"
        finally:
            self._gateway_ws = None
            try:
                self._gateway_loop_ref.close()
            except Exception:
                pass

    async def _gateway_loop_async(self) -> None:
        retry_delay = 3.0
        while not self._stop_event.is_set():
            heartbeat_task: Optional[asyncio.Task] = None
            try:
                gateway_url = self._get_gateway_url()
                async with websockets.connect(gateway_url, ping_interval=None) as ws:
                    self._gateway_ws = ws
                    self._ready = True
                    self._last_error = ""
                    retry_delay = 3.0
                    hello_raw = await ws.recv()
                    await self._on_ws_message(str(hello_raw))
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    while not self._stop_event.is_set():
                        raw = await ws.recv()
                        await self._on_ws_message(str(raw))
            except asyncio.CancelledError:
                self._ready = False
                self._last_error = "qqbot gateway cancelled"
                if self._stop_event.is_set():
                    break
            except BaseException as error:
                self._ready = False
                self._last_error = str(error)
            finally:
                self._gateway_ws = None
                if heartbeat_task is not None:
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass
                    except Exception:
                        pass
            if not self._stop_event.is_set():
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 30.0)

    async def _on_ws_message(self, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return
        op = int(payload.get("op", 0) or 0)
        data = payload.get("d") or {}
        seq = payload.get("s")
        if isinstance(seq, int):
            self._gateway_seq = seq
        if op == 10:
            interval_ms = int((data or {}).get("heartbeat_interval", 45000) or 45000)
            self._heartbeat_interval = max(5.0, interval_ms / 1000.0)
            await self._send_identify()
            return
        if op == 11:
            return
        if op == 7:
            if self._gateway_ws is not None:
                await self._gateway_ws.close()
            return
        if op == 9:
            self._gateway_session_id = ""
            self._gateway_seq = None
            if self._gateway_ws is not None:
                await self._gateway_ws.close()
            return
        if op != 0:
            return
        event_type = str(payload.get("t", "") or "")
        if event_type == "READY":
            self._gateway_session_id = str((data or {}).get("session_id", "") or "")
            return
        normalized = self._normalize_gateway_event(event_type, data, payload)
        if normalized is not None:
            self._dispatch_inbound(normalized)

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._stop_event.is_set() and self._gateway_ws is not None:
                await asyncio.sleep(self._heartbeat_interval)
                if self._stop_event.is_set() or self._gateway_ws is None:
                    break
                await self._gateway_ws.send(
                    json.dumps({"op": 1, "d": self._gateway_seq}, ensure_ascii=False)
                )
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            self._ready = False
            self._last_error = f"qqbot heartbeat failed: {error}"

    async def _send_identify(self) -> None:
        token = self._get_access_token()
        payload = {
            "op": 2,
            "d": {
                "token": f"QQBot {token}",
                "intents": INTENT_GROUP_AND_C2C,
                "shard": [0, 1],
                "properties": {
                    "$os": os.name,
                    "$browser": "aelios",
                    "$device": "aelios",
                },
            },
        }
        if self._gateway_ws is not None:
            await self._gateway_ws.send(json.dumps(payload, ensure_ascii=False))

    def _normalize_inbound(
        self, payload: Dict[str, Any]
    ) -> Optional[QQBotInboundMessage]:
        op = int(payload.get("op", 0) or 0)
        if op == 13:
            return None
        event_type = str(payload.get("t", "") or "")
        return self._normalize_gateway_event(
            event_type, payload.get("d") or {}, payload
        )

    def _normalize_gateway_event(
        self, event_type: str, data: Dict[str, Any], raw: Dict[str, Any]
    ) -> Optional[QQBotInboundMessage]:
        message_id = str(data.get("id", "") or "")
        if not message_id or self._seen_recently(message_id):
            return None
        attachments = self._extract_attachments(data.get("attachments"))
        content = self._sanitize_inbound_text(
            str(data.get("content", "") or ""), attachments
        )
        if event_type in {"C2C_MESSAGE_CREATE", "DIRECT_MESSAGE_CREATE"}:
            author = data.get("author") or {}
            user_id = str(author.get("user_openid", "") or author.get("id", "") or "")
            return QQBotInboundMessage(
                message_id=message_id,
                user_id=user_id,
                text=content,
                message_type="private",
                sender_nickname=str(author.get("username", "") or ""),
                attachments=attachments,
                raw=raw,
            )
        if event_type in {"GROUP_AT_MESSAGE_CREATE", "AT_MESSAGE_CREATE"}:
            author = data.get("author") or {}
            return QQBotInboundMessage(
                message_id=message_id,
                user_id=str(
                    author.get("member_openid", "") or author.get("id", "") or ""
                ),
                group_id=str(
                    data.get("group_openid", "") or data.get("group_id", "") or ""
                ),
                text=content,
                message_type="group",
                sender_nickname=str(author.get("username", "") or ""),
                attachments=attachments,
                raw=raw,
            )
        return None

    def _extract_attachments(self, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, list):
            return []
        attachments: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url", "") or "").strip()
            if url.startswith("//"):
                url = f"https:{url}"
            if not url:
                continue
            content_type = str(
                item.get("content_type", "") or "application/octet-stream"
            )
            filename = str(item.get("filename", "") or "").strip()
            attachment_type = "image" if content_type.startswith("image/") else "file"
            attachments.append(
                {
                    "type": attachment_type,
                    "url": url,
                    "name": filename,
                    "content_type": content_type,
                    "note": filename,
                }
            )
        return attachments

    def _sanitize_inbound_text(
        self, content: str, attachments: list[dict[str, Any]]
    ) -> str:
        text = (content or "").strip()
        text = text.replace("<@!", "@").replace(">", "")
        if text:
            return text
        if attachments:
            return "[用户发送了图片或文件]"
        return ""

    def _extract_outbound_media(
        self, attachments: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        images: list[dict[str, Any]] = []
        files: list[dict[str, Any]] = []
        for item in attachments:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type", "") or "").strip().lower()
            if item_type == "image":
                images.append(item)
            elif item_type == "file":
                files.append(item)
        return images, files

    def _send_private_text(
        self, user_id: str, content: str, *, reply_to: str = ""
    ) -> None:
        for chunk in self._chunk_text(content):
            self._api_request(
                "POST",
                f"/v2/users/{user_id}/messages",
                self._build_text_message_body(chunk, reply_to=reply_to),
            )

    def _send_group_text(
        self, group_openid: str, content: str, *, reply_to: str = ""
    ) -> None:
        for chunk in self._chunk_text(content):
            self._api_request(
                "POST",
                f"/v2/groups/{group_openid}/messages",
                self._build_text_message_body(chunk, reply_to=reply_to),
            )

    def _send_c2c_image(
        self, user_id: str, image: dict[str, Any], *, reply_to: str = ""
    ) -> None:
        file_info = self._upload_media(f"/v2/users/{user_id}/files", image, file_type=1)
        self._api_request(
            "POST",
            f"/v2/users/{user_id}/messages",
            self._build_media_message_body(file_info, reply_to=reply_to),
        )

    def _send_group_image(
        self, group_openid: str, image: dict[str, Any], *, reply_to: str = ""
    ) -> None:
        file_info = self._upload_media(
            f"/v2/groups/{group_openid}/files", image, file_type=1
        )
        self._api_request(
            "POST",
            f"/v2/groups/{group_openid}/messages",
            self._build_media_message_body(file_info, reply_to=reply_to),
        )

    def _send_c2c_file(
        self, user_id: str, file_item: dict[str, Any], *, reply_to: str = ""
    ) -> None:
        file_info = self._upload_media(
            f"/v2/users/{user_id}/files", file_item, file_type=4
        )
        self._api_request(
            "POST",
            f"/v2/users/{user_id}/messages",
            self._build_media_message_body(file_info, reply_to=reply_to),
        )

    def _send_group_file(
        self, group_openid: str, file_item: dict[str, Any], *, reply_to: str = ""
    ) -> None:
        file_info = self._upload_media(
            f"/v2/groups/{group_openid}/files", file_item, file_type=4
        )
        self._api_request(
            "POST",
            f"/v2/groups/{group_openid}/messages",
            self._build_media_message_body(file_info, reply_to=reply_to),
        )

    def _upload_media(self, path: str, item: dict[str, Any], *, file_type: int) -> str:
        url = str(item.get("url", "") or "").strip()
        if url.startswith("http://") or url.startswith("https://"):
            payload: Dict[str, Any] = {
                "file_type": file_type,
                "url": url,
                "srv_send_msg": False,
            }
        else:
            file_path = Path(url).expanduser()
            if not file_path.exists() or not file_path.is_file():
                raise ValueError(f"file not found: {url}")
            raw = file_path.read_bytes()
            payload = {
                "file_type": file_type,
                "file_data": base64.b64encode(raw).decode("ascii"),
                "srv_send_msg": False,
            }
            if file_type == 4:
                payload["file_name"] = str(item.get("name", "") or file_path.name)
        response = self._api_request("POST", path, payload)
        file_info = str(response.get("file_info", "") or "")
        if not file_info:
            raise ValueError("qqbot upload file_info missing")
        return file_info

    def _build_text_message_body(
        self, content: str, *, reply_to: str = ""
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"content": content, "msg_type": 0, "msg_seq": 1}
        if reply_to:
            body["msg_id"] = reply_to
        return body

    def _build_media_message_body(
        self, file_info: str, *, reply_to: str = ""
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "msg_type": 7,
            "media": {"file_info": file_info},
            "msg_seq": 1,
        }
        if reply_to:
            body["msg_id"] = reply_to
        return body

    def _api_request(
        self, method: str, path: str, body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        token = self._get_access_token()
        url = f"{QQBOT_API_BASE}{path}"
        payload = json.dumps(body or {}, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload if method.upper() != "GET" else None,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"QQBot {token}",
                "User-Agent": "aelios-gateway/0.1",
            },
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise ValueError(f"qqbot request failed: {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise ValueError(f"qqbot request failed: {error}") from error
        if not raw:
            return {}
        data = json.loads(raw)
        if isinstance(data, dict) and data.get("code"):
            raise ValueError(f"qqbot api error: {data}")
        return data

    def _get_gateway_url(self) -> str:
        data = self._api_request("GET", "/gateway")
        url = str(data.get("url", "") or "").strip()
        if not url:
            raise ValueError("qqbot gateway url missing")
        return url

    def _get_access_token(self) -> str:
        now = time.time()
        with self._token_lock:
            if self._access_token and now < self._access_token_expire_at - 300:
                return self._access_token
            payload = json.dumps(
                {"appId": self.config.app_id, "clientSecret": self.config.token},
                ensure_ascii=False,
            ).encode("utf-8")
            request = urllib.request.Request(
                QQBOT_ACCESS_TOKEN_URL,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "aelios-gateway/0.1",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    raw = response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")
                raise ValueError(
                    f"qqbot get token failed: {error.code} {detail}"
                ) from error
            except urllib.error.URLError as error:
                raise ValueError(f"qqbot get token failed: {error}") from error
            data = json.loads(raw)
            token = str(data.get("access_token", "") or "").strip()
            expires_in = int(data.get("expires_in", 7200) or 7200)
            if not token:
                raise ValueError(f"qqbot get token failed: {data}")
            self._access_token = token
            self._access_token_expire_at = now + expires_in
            return token

    def _chunk_text(self, content: str) -> list[str]:
        text = content.strip() or "[空回复]"
        size = max(200, self.config.send_chunk_chars)
        return [text[i : i + size] for i in range(0, len(text), size)] or [text]

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
