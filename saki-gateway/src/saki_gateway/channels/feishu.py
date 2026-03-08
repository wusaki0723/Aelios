from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, Optional


@dataclass
class FeishuChannelConfig:
    app_id: str
    app_secret: str
    enabled: bool = False
    auto_reconnect: bool = True
    debug: bool = False
    card_title: str = "Saki"
    patch_interval_ms: int = 450
    patch_min_chars: int = 24


@dataclass
class FeishuInboundMessage:
    message_id: str
    sender_open_id: str
    chat_id: str
    chat_type: str
    text: str
    thread_id: str = ""
    raw: Optional[dict[str, Any]] = None


_LARK_WS_COMPAT_PATCHED = False


def _patch_lark_websocket_compat() -> None:
    global _LARK_WS_COMPAT_PATCHED
    if _LARK_WS_COMPAT_PATCHED:
        return

    import lark_oapi.ws.client as lark_ws_client
    import websockets

    connect_impl = websockets.connect
    try:
        from websockets.legacy.client import connect as legacy_connect

        connect_impl = legacy_connect
    except Exception:
        pass

    invalid_status_types: tuple[type[BaseException], ...] = tuple(
        candidate
        for candidate in (
            getattr(websockets, "InvalidStatusCode", None),
            getattr(getattr(websockets, "exceptions", None), "InvalidStatus", None),
            getattr(getattr(websockets, "exceptions", None), "InvalidStatusCode", None),
        )
        if isinstance(candidate, type) and issubclass(candidate, BaseException)
    )

    def _handshake_headers(error: BaseException) -> Any:
        headers = getattr(error, "headers", None)
        if headers is not None:
            return headers
        response = getattr(error, "response", None)
        if response is not None:
            return getattr(response, "headers", None)
        return None

    def _parse_ws_conn_exception_compat(error: BaseException) -> None:
        headers = _handshake_headers(error)
        if headers is None:
            raise error

        code = headers.get(lark_ws_client.HEADER_HANDSHAKE_STATUS)
        msg = headers.get(lark_ws_client.HEADER_HANDSHAKE_MSG)
        if code is None or msg is None:
            raise error

        code_num = int(code)
        if code_num == lark_ws_client.AUTH_FAILED:
            auth_code = headers.get(lark_ws_client.HEADER_HANDSHAKE_AUTH_ERRCODE)
            if auth_code is not None and int(auth_code) == lark_ws_client.EXCEED_CONN_LIMIT:
                raise lark_ws_client.ClientException(code_num, msg)
            raise lark_ws_client.ServerException(code_num, msg)
        if code_num == lark_ws_client.FORBIDDEN:
            raise lark_ws_client.ClientException(code_num, msg)
        raise lark_ws_client.ServerException(code_num, msg)

    async def _connect_compat(self: Any) -> None:
        await self._lock.acquire()
        try:
            if self._conn is not None:
                return
            conn_url = self._get_conn_url()
            from urllib.parse import parse_qs, urlparse

            parsed = urlparse(conn_url)
            query = parse_qs(parsed.query)
            conn_id = query[lark_ws_client.DEVICE_ID][0]
            service_id = query[lark_ws_client.SERVICE_ID][0]

            conn = await connect_impl(conn_url)
            self._conn = conn
            self._conn_url = conn_url
            self._conn_id = conn_id
            self._service_id = service_id

            lark_ws_client.logger.info(self._fmt_log("connected to {}", conn_url))
            lark_ws_client.loop.create_task(self._receive_message_loop())
        except Exception as error:
            if invalid_status_types and isinstance(error, invalid_status_types):
                _parse_ws_conn_exception_compat(error)
            raise
        finally:
            self._lock.release()

    async def _receive_message_loop_compat(self: Any) -> None:
        try:
            while True:
                if self._conn is None:
                    raise lark_ws_client.ConnectionClosedException("connection is closed")
                msg = await self._conn.recv()
                lark_ws_client.loop.create_task(self._handle_message(msg))
        except Exception as error:
            try:
                from websockets.exceptions import ConnectionClosedOK

                if isinstance(error, ConnectionClosedOK) and not getattr(self, "_auto_reconnect", True):
                    await self._disconnect()
                    return
            except Exception:
                pass
            lark_ws_client.logger.error(self._fmt_log("receive message loop exit, err: {}", error))
            await self._disconnect()
            if getattr(self, "_auto_reconnect", True):
                await self._reconnect()
            else:
                raise error

    def _start_compat(self: Any) -> None:
        loop = asyncio.new_event_loop()
        setattr(self, "_saki_loop", loop)
        lark_ws_client.loop = loop
        asyncio.set_event_loop(loop)

        async def _bootstrap() -> None:
            await self._connect()
            loop.create_task(self._ping_loop())

        try:
            loop.run_until_complete(_bootstrap())
            loop.run_forever()
        except lark_ws_client.ClientException as error:
            lark_ws_client.logger.error(self._fmt_log("connect failed, err: {}", error))
            raise error
        except Exception as error:
            lark_ws_client.logger.error(self._fmt_log("connect failed, err: {}", error))
            try:
                loop.run_until_complete(self._disconnect())
            except Exception:
                pass
            if getattr(self, "_auto_reconnect", True):
                loop.run_until_complete(self._reconnect())
                loop.run_forever()
            else:
                raise error
        finally:
            pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
            for task in pending:
                task.cancel()
            if pending:
                try:
                    loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception:
                    pass
            loop.close()

    lark_ws_client.Client._connect = _connect_compat
    lark_ws_client.Client._receive_message_loop = _receive_message_loop_compat
    lark_ws_client.Client.start = _start_compat
    lark_ws_client._parse_ws_conn_exception = _parse_ws_conn_exception_compat
    _LARK_WS_COMPAT_PATCHED = True


class FeishuChannel:
    def __init__(self, config: FeishuChannelConfig):
        self.config = config
        self._thread: Optional[threading.Thread] = None
        self._ready = False
        self._last_error = ""
        self._event_handler: Optional[Callable[[dict[str, Any]], Iterable[str]]] = None
        self._user_locks: Dict[str, threading.Lock] = {}
        self._user_locks_guard = threading.Lock()
        self._recent_messages: OrderedDict[str, float] = OrderedDict()
        self._recent_limit = 2048
        self._api_client = None
        self._ws_client = None

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "mode": "websocket",
            "ready": self._ready,
            "note": self._status_note(),
        }

    def start(self, on_message: Optional[Callable[[dict[str, Any]], Iterable[str]]] = None) -> None:
        if not self.config.enabled:
            return
        if not self.config.app_id or not self.config.app_secret:
            raise ValueError("feishu app_id and app_secret are required")
        if self._thread and self._thread.is_alive():
            return
        self._event_handler = on_message
        self._thread = threading.Thread(target=self._run_forever, name="feishu-ws", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._ready = False
        self._last_error = "stopped"
        self._api_client = None
        thread = self._thread
        ws_client = self._ws_client
        self._ws_client = None
        if ws_client is not None:
            try:
                setattr(ws_client, "_auto_reconnect", False)
            except Exception:
                pass
            try:
                loop = getattr(ws_client, "_saki_loop", None)
                disconnect = getattr(ws_client, "_disconnect", None)
                if loop is not None and disconnect is not None and getattr(loop, "is_running", lambda: False)():
                    future = asyncio.run_coroutine_threadsafe(disconnect(), loop)
                    future.result(timeout=5)
            except Exception:
                pass
            try:
                loop = getattr(ws_client, "_saki_loop", None)
                if loop is not None and getattr(loop, "is_running", lambda: False)():
                    loop.call_soon_threadsafe(loop.stop)
            except Exception:
                pass
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=6)
        if self._thread is thread:
            self._thread = None

    def send_card(self, open_id: str, content: str, loading: bool = False, chat_id: str = "", chat_type: str = "p2p") -> str:
        client = self._require_client()
        import lark_oapi as lark

        receive_id_type, receive_id = self._resolve_receive_target(open_id, chat_id, chat_type)
        request = (
            lark.im.v1.CreateMessageRequest.builder()
            .receive_id_type(receive_id_type)
            .request_body(
                lark.im.v1.CreateMessageRequestBody.builder()
                .receive_id(receive_id)
                .msg_type("interactive")
                .content(json.dumps(self._build_card(content, loading=loading), ensure_ascii=False))
                .uuid(str(uuid.uuid4()))
                .build()
            )
            .build()
        )
        response = client.im.v1.message.create(request)
        if getattr(response, "code", -1) != 0:
            raise ValueError(f"feishu create card failed: {getattr(response, 'msg', 'unknown error')}")
        return str(getattr(getattr(response, "data", None), "message_id", ""))

    def patch_card(self, message_id: str, content: str) -> None:
        client = self._require_client()
        import lark_oapi as lark

        request = (
            lark.im.v1.PatchMessageRequest.builder()
            .message_id(message_id)
            .request_body(
                lark.im.v1.PatchMessageRequestBody.builder()
                .content(json.dumps(self._build_card(content, loading=False), ensure_ascii=False))
                .build()
            )
            .build()
        )
        response = client.im.v1.message.patch(request)
        if getattr(response, "code", -1) != 0:
            raise ValueError(f"feishu patch card failed: {getattr(response, 'msg', 'unknown error')}")

    def send_text(self, open_id: str, content: str, chat_id: str = "", chat_type: str = "p2p") -> None:
        client = self._require_client()
        import lark_oapi as lark

        receive_id_type, receive_id = self._resolve_receive_target(open_id, chat_id, chat_type)
        request = (
            lark.im.v1.CreateMessageRequest.builder()
            .receive_id_type(receive_id_type)
            .request_body(
                lark.im.v1.CreateMessageRequestBody.builder()
                .receive_id(receive_id)
                .msg_type("text")
                .content(json.dumps({"text": content}, ensure_ascii=False))
                .uuid(str(uuid.uuid4()))
                .build()
            )
            .build()
        )
        response = client.im.v1.message.create(request)
        if getattr(response, "code", -1) != 0:
            raise ValueError(f"feishu send text failed: {getattr(response, 'msg', 'unknown error')}")

    def _run_forever(self) -> None:
        try:
            import lark_oapi as lark

            _patch_lark_websocket_compat()
            self._api_client = (
                lark.Client.builder()
                .app_id(self.config.app_id)
                .app_secret(self.config.app_secret)
                .log_level(lark.LogLevel.DEBUG if self.config.debug else lark.LogLevel.INFO)
                .build()
            )
            event_handler = (
                lark.EventDispatcherHandler.builder("", "")
                .register_p2_im_message_receive_v1(self._on_receive_message)
                .build()
            )
            self._ws_client = lark.ws.Client(
                self.config.app_id,
                self.config.app_secret,
                log_level=lark.LogLevel.DEBUG if self.config.debug else lark.LogLevel.INFO,
                event_handler=event_handler,
                auto_reconnect=self.config.auto_reconnect,
            )
            self._ready = True
            self._last_error = ""
            self._ws_client.start()
        except Exception as error:
            self._ready = False
            self._last_error = f"{type(error).__name__}: {error}"
        finally:
            self._ready = False
            self._thread = None

    def _status_note(self) -> str:
        if self._last_error:
            return self._last_error
        if self._ready:
            return "connected"
        if self._thread and self._thread.is_alive():
            return "connecting"
        return "idle"

    def _on_receive_message(self, data: object) -> None:
        normalized = self._normalize_inbound(data)
        if normalized is None:
            return
        worker = threading.Thread(target=self._process_inbound, args=(normalized,), daemon=True)
        worker.start()

    def _process_inbound(self, message: FeishuInboundMessage) -> None:
        if self._event_handler is None:
            return
        lock = self._lock_for(message.sender_open_id or message.chat_id)
        with lock:
            card_id = ""
            final_text = ""
            try:
                card_id = self.send_card(
                    message.sender_open_id,
                    "正在想怎么回你。",
                    loading=True,
                    chat_id=message.chat_id,
                    chat_type=message.chat_type,
                )
            except Exception:
                card_id = ""

            try:
                chunks = self._event_handler(
                    {
                        "channel": "feishu",
                        "message_id": message.message_id,
                        "open_id": message.sender_open_id,
                        "chat_id": message.chat_id,
                        "chat_type": message.chat_type,
                        "thread_id": message.thread_id,
                        "text": message.text,
                    }
                )
                final_text = self._stream_to_card(card_id, message, chunks)
            except Exception as error:
                fallback = f"这边刚刚出了点问题：{error}"
                if card_id:
                    try:
                        self.patch_card(card_id, fallback)
                        return
                    except Exception:
                        pass
                self.send_text(message.sender_open_id, fallback, chat_id=message.chat_id, chat_type=message.chat_type)

            if not final_text:
                final_text = "我这边暂时没有整理出可发送的内容。"
            if not card_id:
                self.send_text(message.sender_open_id, final_text, chat_id=message.chat_id, chat_type=message.chat_type)

    def _stream_to_card(self, card_id: str, message: FeishuInboundMessage, chunks: Iterable[str]) -> str:
        buffer = ""
        last_patch_at = 0.0
        for chunk in chunks:
            if not chunk:
                continue
            buffer += chunk
            if not card_id:
                continue
            now = time.monotonic()
            due_by_chars = len(buffer) >= self.config.patch_min_chars
            due_by_time = now - last_patch_at >= self.config.patch_interval_ms / 1000.0
            if due_by_chars and due_by_time:
                self.patch_card(card_id, buffer)
                last_patch_at = now
        if card_id:
            self.patch_card(card_id, buffer or "我在这。")
        return buffer

    def _normalize_inbound(self, data: object) -> Optional[FeishuInboundMessage]:
        event = getattr(data, "event", None)
        sender = getattr(event, "sender", None)
        message = getattr(event, "message", None)
        if sender is None or message is None:
            return None
        sender_id = getattr(sender, "sender_id", None)
        open_id = str(getattr(sender_id, "open_id", "") or "")
        if not open_id:
            open_id = str(getattr(sender_id, "user_id", "") or getattr(sender_id, "union_id", "") or "")
        message_id = str(getattr(message, "message_id", "") or "")
        if not message_id or self._seen_recently(message_id):
            return None
        message_type = str(getattr(message, "message_type", "") or "")
        content = self._extract_message_text(message_type, str(getattr(message, "content", "") or ""))
        if not content.strip():
            content = "[暂不支持直接解析的消息类型]"
        return FeishuInboundMessage(
            message_id=message_id,
            sender_open_id=open_id,
            chat_id=str(getattr(message, "chat_id", "") or ""),
            chat_type=str(getattr(message, "chat_type", "") or "p2p"),
            text=content,
            thread_id=str(getattr(message, "thread_id", "") or ""),
            raw=None,
        )

    def _extract_message_text(self, message_type: str, content: str) -> str:
        if not content:
            return ""
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            return content
        if message_type == "text":
            return str(payload.get("text", ""))
        if message_type == "post":
            return str(payload)
        return str(payload)

    def _build_card(self, content: str, *, loading: bool) -> dict[str, Any]:
        safe_text = self._truncate_card_text(content)
        status_line = "正在整理中…" if loading else ""
        return {
            "config": {
                "wide_screen_mode": True,
                "enable_forward": True,
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": f"**{status_line}**\n\n{safe_text}" if status_line else safe_text,
                }
            ],
        }

    def _truncate_card_text(self, content: str) -> str:
        if len(content) <= 12000:
            return content
        return content[:11950] + "\n\n[内容过长，已截断显示]"

    def _require_client(self) -> Any:
        if self._api_client is None:
            raise RuntimeError("feishu api client is not ready")
        return self._api_client

    def _resolve_receive_target(self, open_id: str, chat_id: str, chat_type: str) -> tuple[str, str]:
        if chat_type and chat_type != "p2p" and chat_id:
            return ("chat_id", chat_id)
        return ("open_id", open_id)

    def _seen_recently(self, message_id: str) -> bool:
        now = time.time()
        if message_id in self._recent_messages:
            self._recent_messages.move_to_end(message_id)
            return True
        self._recent_messages[message_id] = now
        while len(self._recent_messages) > self._recent_limit:
            self._recent_messages.popitem(last=False)
        return False

    def _lock_for(self, user_key: str) -> threading.Lock:
        with self._user_locks_guard:
            lock = self._user_locks.get(user_key)
            if lock is None:
                lock = threading.Lock()
                self._user_locks[user_key] = lock
            return lock
