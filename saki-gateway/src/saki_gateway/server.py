from __future__ import annotations

import base64
import copy
import hashlib
import json
import mimetypes
import re
import sys
import threading
from dataclasses import asdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import parse_qs, urlparse

from .config import ConfigStore, default_config_path
from .config import normalize_dashboard_password
from .config import resolve_data_path
from .llm import extract_text_content, request_chat_completion, stream_chat_completion
from .llm import extract_finish_reason, extract_tool_calls
from .memory import MemoryStore
from .runtime_store import RuntimeStore
from .trilium import TriliumClient
from .scheduler import GatewayScheduler
from .tools import (
    build_default_registry,
    prepare_image_context,
    prepare_search_context,
    prepare_shared_link_context,
)


class GatewayApp:
    CORE_PROFILE_SECTIONS = {"About Her", "Relationship Core", "My Profile"}
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.dashboard_root = self._find_dashboard_root()
        self.config_store = ConfigStore(default_config_path(self.root))
        self._memory_db_path = resolve_data_path(
            self.root, self.config_store.config.memory.database_path, "data/memories.db"
        )
        self._runtime_db_path = resolve_data_path(
            self.root,
            self.config_store.config.memory.operational_db_path,
            "data/gateway.db",
        )
        self._event_log_path = resolve_data_path(
            self.root,
            self.config_store.config.memory.event_log_path,
            "data/raw/events.jsonl",
        )
        self._hot_memory_path = resolve_data_path(
            self.root,
            self.config_store.config.memory.hot_memory_path,
            "data/active_memory.md",
        )
        self._core_memory_path = resolve_data_path(
            self.root,
            self.config_store.config.memory.core_memory_path,
            "data/core_profile.md",
        )
        self._digest_run_state_path = resolve_data_path(
            self.root,
            self.config_store.config.memory.digest_run_state_path,
            "data/digest_run_state.json",
        )
        self.config_store.config.memory.database_path = str(
            self._memory_db_path.relative_to(self.root)
        )
        self.config_store.config.memory.operational_db_path = str(
            self._runtime_db_path.relative_to(self.root)
        )
        self.config_store.config.memory.event_log_path = str(
            self._event_log_path.relative_to(self.root)
        )
        self.config_store.config.memory.hot_memory_path = str(
            self._hot_memory_path.relative_to(self.root)
        )
        self.config_store.config.memory.core_memory_path = str(
            self._core_memory_path.relative_to(self.root)
        )
        self.config_store.config.memory.digest_run_state_path = str(
            self._digest_run_state_path.relative_to(self.root)
        )
        self.memory_store = MemoryStore(
            self._memory_db_path,
            vector_weight=self.config_store.config.memory.vector_weight,
            keyword_weight=self.config_store.config.memory.keyword_weight,
        )
        self.runtime_store = RuntimeStore(
            self._runtime_db_path,
            self._event_log_path,
        )
        self.trilium_client = TriliumClient(self.config_store.config.trilium)
        self.tools = build_default_registry(
            root,
            lambda: self.config_store.config,
            memory_store=self.memory_store,
            runtime_store=self.runtime_store,
            dispatch_message=self.dispatch_proactive_message,
            trilium_client=self.trilium_client,
        )
        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        self.feishu_channel = self._build_feishu_channel()
        self.qqbot_channel = self._build_qqbot_channel()
        self.napcat_channel = self._build_napcat_channel()
        self.scheduler = GatewayScheduler(
            self.runtime_store,
            lambda: self.config_store.config.scheduler,
            self._deliver_due_reminder,
            self._send_idle_proactive_ping,
            on_memory_digest=self._run_scheduled_nightly_digest,
        )
        self._goodnight_phrases = [
            "晚安",
            "先睡了",
            "睡觉了",
            "我要睡了",
            "我去睡了",
            "睡了",
            "good night",
            "goodnight",
        ]

    def state(self) -> Dict[str, Any]:
        config = self.config_store.config
        return {
            "host": config.host,
            "port": config.port,
            "persona": config.persona.partner_name,
            "enabled_tools": self.tools.list_enabled(),
            "memory_count": len(self.list_memories_grouped().get("items", [])),
            "log_count": len(
                self.memory_store.list_memories(limit=1000, memory_kind="daily_log")
            ),
            "memory_enabled": config.memory.enabled,
            "runtime": self.runtime_store.stats(),
            "channels": {
                "feishu": self.feishu_channel.status()
                if self.feishu_channel
                else {"enabled": False, "ready": False},
                "qqbot": self.qqbot_channel.status()
                if self.qqbot_channel
                else {"enabled": False, "ready": False},
                "qq": self.napcat_channel.status()
                if self.napcat_channel
                else {"enabled": False, "ready": False},
            },
            "scheduler": self.scheduler.status(),
            "dashboard": {
                "enabled": self.dashboard_root is not None,
                "root": str(self.dashboard_root) if self.dashboard_root else "",
            },
            "context_files": {
                "core_profile": str(self._core_memory_file()),
                "active_memory": str(self._active_memory_file()),
                "event_log": str(self._event_log_path),
                "digest_run_state": str(self._digest_run_state_file()),
            },
        }

    def public_config_payload(self) -> Dict[str, Any]:
        payload = asdict(self.config_store.config)
        dashboard_security = payload.get("dashboard_security") or {}
        dashboard_security["password"] = ""
        payload["dashboard_security"] = dashboard_security
        trilium = payload.get("trilium") or {}
        trilium["token"] = ""
        payload["trilium"] = trilium
        return payload

    def export_backup_payload(self) -> Dict[str, Any]:
        return {
            "schema_version": 1,
            "exported_at": datetime.now().isoformat(),
            "persona": self.public_config_payload().get("persona") or {},
            "memories": [
                self._serialize_memory(record)
                for record in self.memory_store.list_memories(
                    limit=5000, memory_kind="long_term"
                )
                if getattr(record, "category", "") != "memory_refresh"
            ],
            "logs": [
                self._serialize_memory(record)
                for record in self.memory_store.list_memories(
                    limit=5000, memory_kind="daily_log"
                )
            ],
        }

    def import_backup_payload(self, body: Dict[str, Any]) -> Dict[str, Any]:
        persona = body.get("persona") or {}
        memories = body.get("memories") or []
        logs = body.get("logs") or []
        if not isinstance(persona, dict):
            raise ValueError("persona must be an object")
        if not isinstance(memories, list) or not isinstance(logs, list):
            raise ValueError("memories and logs must be arrays")

        persona_payload = {"persona": persona} if persona else {}
        if persona_payload:
            self.update_config(persona_payload)

        imported_memories = 0
        imported_logs = 0
        for item in memories:
            if not isinstance(item, dict):
                continue
            memory_id = str(item.get("id", "") or "").strip()
            key = str(item.get("key", "") or item.get("title", "")).strip()
            content = str(item.get("content", "") or "").strip()
            if not memory_id or not key or not content:
                continue
            self.memory_store.upsert_memory(
                memory_id=memory_id,
                key=key,
                content=content,
                memory_kind="long_term",
                category=str(item.get("category", "other") or "other").strip()
                or "other",
                importance=max(
                    0.0, min(1.0, float(item.get("importance", 0.5) or 0.5))
                ),
                session_id=str(item.get("session_id", "") or ""),
            )
            imported_memories += 1

        for item in logs:
            if not isinstance(item, dict):
                continue
            memory_id = str(item.get("id", "") or "").strip()
            key = str(item.get("key", "") or item.get("title", "")).strip()
            content = str(item.get("content", "") or "").strip()
            if not memory_id or not key or not content:
                continue
            self.memory_store.upsert_memory(
                memory_id=memory_id,
                key=key,
                content=content,
                memory_kind="daily_log",
                category="daily_log",
                importance=max(
                    0.0, min(1.0, float(item.get("importance", 0.2) or 0.2))
                ),
                session_id=str(item.get("session_id", "") or ""),
            )
            imported_logs += 1

        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        return {
            "ok": True,
            "imported": {
                "persona": bool(persona_payload),
                "memories": imported_memories,
                "logs": imported_logs,
            },
        }

    def start_channels(self) -> None:
        if self.feishu_channel is not None:
            self.feishu_channel.start(self.handle_feishu_message)
        if self.qqbot_channel is not None:
            self.qqbot_channel.start(self.handle_qqbot_message)
        if self.napcat_channel is not None:
            self.napcat_channel.start(self.handle_napcat_message)
        self.scheduler.start()

    def shutdown(self) -> None:
        if self.feishu_channel is not None:
            self.feishu_channel.stop()
        if self.qqbot_channel is not None:
            self.qqbot_channel.stop()
        if self.napcat_channel is not None:
            self.napcat_channel.stop()
        self.scheduler.stop()

    def update_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.scheduler.stop()
        if self.feishu_channel is not None:
            self.feishu_channel.stop()
        if self.qqbot_channel is not None:
            self.qqbot_channel.stop()
        if self.napcat_channel is not None:
            self.napcat_channel.stop()
        config = self.config_store.update(payload)
        self.trilium_client = TriliumClient(self.config_store.config.trilium)
        self.tools = build_default_registry(
            self.root,
            lambda: self.config_store.config,
            memory_store=self.memory_store,
            runtime_store=self.runtime_store,
            dispatch_message=self.dispatch_proactive_message,
            trilium_client=self.trilium_client,
        )
        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        self.feishu_channel = self._build_feishu_channel()
        self.qqbot_channel = self._build_qqbot_channel()
        self.napcat_channel = self._build_napcat_channel()
        if self.feishu_channel is not None:
            self.feishu_channel.start(self.handle_feishu_message)
        if self.qqbot_channel is not None:
            self.qqbot_channel.start(self.handle_qqbot_message)
        if self.napcat_channel is not None:
            self.napcat_channel.start(self.handle_napcat_message)
        self.scheduler.start()
        return {"config": self.public_config_payload()}

    def chat_complete(self, body: Dict[str, Any]) -> Dict[str, Any]:
        messages = self._coerce_messages(body)
        profile_id, session = self._resolve_request_session(body)
        provider_name = str(body.get("provider", "chat")).strip().lower()
        provider = self._provider_for_request(
            provider_name, str(body.get("model", "") or "").strip()
        )
        response = request_chat_completion(
            provider,
            messages,
            stream=False,
            temperature=float(body.get("temperature", 0.7)),
        )
        content = extract_text_content(response)
        self._append_messages_to_session(
            session.session_id,
            profile_id,
            messages,
            content,
            channel=str(body.get("channel", "web") or "web"),
        )
        self._record_event(
            "chat_complete",
            {
                "provider": provider_name,
                "messages": messages,
                "response": content[:2000],
            },
            profile_id=profile_id,
            session_id=session.session_id,
            channel=str(body.get("channel", "web") or "web"),
        )
        self._refresh_active_memory()
        self._extract_memories_from_chat(
            messages,
            content,
            profile_id=profile_id,
            session_id=session.session_id,
        )
        return {
            "content": content,
            "raw": response,
            "profile_id": profile_id,
            "session_id": session.session_id,
        }

    def chat_respond(self, body: Dict[str, Any]) -> Dict[str, Any]:
        messages = self._coerce_messages(body)
        profile_id, session = self._resolve_request_session(body)
        attachments = body.get("attachments") or []
        search_query = str(body.get("search_query", "") or "").strip()
        tool_contexts = self._prepare_tool_contexts(messages, attachments, search_query)
        content, response, loop_tool_contexts = self._generate_chat_reply(
            messages=messages,
            tool_contexts=tool_contexts,
            session_id=session.session_id,
            temperature=float(body.get("temperature", 0.7)),
            profile_id=profile_id,
        )
        all_tool_contexts = tool_contexts + loop_tool_contexts
        self._append_messages_to_session(
            session.session_id,
            profile_id,
            messages,
            content,
            channel=str(body.get("channel", "web") or "web"),
        )
        self._record_event(
            "chat_respond",
            {
                "messages": messages,
                "attachments": attachments,
                "tool_contexts": all_tool_contexts,
                "response": content[:2000],
            },
            profile_id=profile_id,
            session_id=session.session_id,
            channel=str(body.get("channel", "web") or "web"),
        )
        self._refresh_active_memory()
        self._extract_memories_from_chat(
            messages,
            content,
            profile_id=profile_id,
            session_id=session.session_id,
        )
        return {
            "content": content,
            "tool_contexts": all_tool_contexts,
            "raw": response,
            "profile_id": profile_id,
            "session_id": session.session_id,
        }

    def openai_compatible_chat(
        self, body: Dict[str, Any], provider_name: str = "chat"
    ) -> Dict[str, Any]:
        messages = body.get("messages") or []
        if not messages:
            raise ValueError("messages is required")
        provider = self._provider_for_request(
            provider_name, str(body.get("model", "") or "").strip()
        )
        response = request_chat_completion(
            provider,
            messages,
            stream=False,
            temperature=float(body.get("temperature", 0.7)),
        )
        if isinstance(response, dict) and response.get("choices"):
            return response
        content = extract_text_content(response)
        return {
            "id": "chatcmpl-saki",
            "object": "chat.completion",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
        }

    def stream_chat_reply(
        self,
        *,
        messages: list[Dict[str, str]],
        profile_id: str = "local-user",
        session_id: str = "",
        channel: str = "web",
        attachments: Optional[list[Dict[str, Any]]] = None,
        search_query: str = "",
        temperature: float = 0.7,
        event_type: str = "chat_stream",
        event_payload: Optional[Dict[str, Any]] = None,
    ) -> Iterable[str]:
        if not session_id:
            _, session = self._resolve_request_session(
                {"profile_id": profile_id, "channel": channel}
            )
            session_id = session.session_id
        tool_contexts = self._prepare_tool_contexts(
            messages, attachments or [], search_query
        )

        def generate() -> Iterable[str]:
            collected: list[str] = []
            final_tool_contexts: list[Dict[str, Any]] = list(tool_contexts)
            try:
                content, _, loop_tool_contexts = self._generate_chat_reply(
                    messages=messages,
                    tool_contexts=tool_contexts,
                    session_id=session_id,
                    temperature=temperature,
                    profile_id=profile_id,
                )
                final_tool_contexts.extend(loop_tool_contexts)
                if content:
                    collected.append(content)
                    yield content
            finally:
                payload = dict(event_payload or {})
                payload.update(
                    {
                        "messages": messages,
                        "tool_contexts": final_tool_contexts,
                        "response": "".join(collected)[:2000],
                    }
                )
                self._append_messages_to_session(
                    session_id,
                    profile_id,
                    messages,
                    "".join(collected),
                    channel=channel,
                )
                self._record_event(
                    event_type,
                    payload,
                    profile_id=profile_id,
                    session_id=session_id,
                    channel=channel,
                )
                self._refresh_active_memory()
                self._extract_memories_from_chat(
                    messages,
                    "".join(collected),
                    profile_id=profile_id,
                    session_id=session_id,
                )

        return generate()

    def _generate_chat_reply(
        self,
        *,
        messages: list[Dict[str, Any]],
        tool_contexts: list[Dict[str, Any]],
        session_id: str,
        temperature: float,
        profile_id: str,
        max_rounds: int = 6,
    ) -> tuple[str, Dict[str, Any], list[Dict[str, Any]]]:
        base_messages = self._build_main_chat_messages(
            messages, tool_contexts, session_id
        )
        tool_specs = self._chat_tool_specs(profile_id, messages)
        loop_tool_contexts: list[Dict[str, Any]] = []
        last_response: Dict[str, Any] = {}
        tool_provider = self._preferred_tool_provider()
        final_messages = self._build_action_runtime_messages(
            messages, tool_contexts, session_id
        )
        executed_tool_fingerprints: set[tuple[str, str]] = set()
        for _ in range(max_rounds):
            response = request_chat_completion(
                tool_provider,
                final_messages,
                stream=False,
                temperature=temperature,
                tools=tool_specs,
                tool_choice="auto" if tool_specs else "none",
            )
            last_response = response
            content = extract_text_content(response).strip()
            tool_calls = extract_tool_calls(response)
            finish_reason = extract_finish_reason(response)
            if not tool_calls:
                if self._provider_is_chat(tool_provider):
                    return content, response, loop_tool_contexts
                synthesized = self._synthesize_companion_reply(
                    messages=messages,
                    tool_contexts=tool_contexts + loop_tool_contexts,
                    session_id=session_id,
                    temperature=temperature,
                    fallback_content=content,
                )
                return synthesized[0], synthesized[1], loop_tool_contexts

            assistant_message = (response.get("choices") or [{}])[0].get(
                "message"
            ) or {}
            final_messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.get("content", content),
                    "tool_calls": assistant_message.get("tool_calls") or tool_calls,
                }
            )
            for tool_call in tool_calls:
                tool_name = str(tool_call.get("name", "") or "").strip()
                raw_arguments = (
                    str(tool_call.get("arguments", "") or "{}").strip() or "{}"
                )
                try:
                    arguments = json.loads(raw_arguments)
                except json.JSONDecodeError:
                    arguments = {"raw_arguments": raw_arguments}
                arguments = self._enrich_tool_arguments(
                    tool_name, arguments, profile_id
                )
                fingerprint = (
                    tool_name,
                    json.dumps(arguments, ensure_ascii=False, sort_keys=True),
                )
                if (
                    tool_name == "create_reminder"
                    and fingerprint in executed_tool_fingerprints
                ):
                    result = {
                        "ok": True,
                        "tool": tool_name,
                        "deduplicated": True,
                        "note": "duplicate reminder creation in the same request was skipped",
                    }
                    final_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": str(tool_call.get("id", "") or tool_name),
                            "name": tool_name,
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )
                    continue
                try:
                    result = self.tools.execute(tool_name, arguments)
                    executed_tool_fingerprints.add(fingerprint)
                except Exception as error:
                    result = {
                        "ok": False,
                        "tool": tool_name,
                        "error": str(error),
                    }
                tool_context = self._tool_result_to_context(
                    tool_name, arguments, result
                )
                if tool_context is not None:
                    loop_tool_contexts.append(tool_context)
                final_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(tool_call.get("id", "") or tool_name),
                        "name": tool_name,
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )
            if finish_reason != "tool_calls" and content:
                if self._provider_is_chat(tool_provider):
                    return content, response, loop_tool_contexts
                synthesized = self._synthesize_companion_reply(
                    messages=messages,
                    tool_contexts=tool_contexts + loop_tool_contexts,
                    session_id=session_id,
                    temperature=temperature,
                    fallback_content=content,
                )
                return synthesized[0], synthesized[1], loop_tool_contexts
        raise ValueError("tool calling exceeded maximum rounds")

    def _preferred_tool_provider(self) -> Any:
        action_provider = self.config_store.config.action_api
        if self._provider_ready(action_provider):
            return action_provider
        return self.config_store.config.chat_api

    def _preferred_extraction_provider(self) -> Any:
        action_provider = self.config_store.config.action_api
        if self._provider_ready(action_provider):
            return action_provider
        chat_provider = self.config_store.config.chat_api
        if self._provider_ready(chat_provider):
            return chat_provider
        return None

    def _provider_ready(self, provider: Any) -> bool:
        return bool(
            getattr(provider, "enabled", False)
            and getattr(provider, "base_url", "")
            and getattr(provider, "api_key", "")
            and getattr(provider, "model", "")
        )

    def _provider_is_chat(self, provider: Any) -> bool:
        return provider is self.config_store.config.chat_api

    def provider_status_payload(self) -> Dict[str, Any]:
        config = self.config_store.config
        return {
            "chat_api": self._provider_status(config.chat_api),
            "action_api": self._provider_status(config.action_api),
            "search_api": self._provider_status(config.search_api),
        }

    def _provider_status(self, provider: Any) -> Dict[str, Any]:
        return {
            "enabled": bool(getattr(provider, "enabled", False)),
            "configured": self._provider_ready(provider),
            "label": str(
                getattr(provider, "label", "")
                or getattr(provider, "backend_type", "")
                or "unknown"
            ),
            "has_base_url": bool(getattr(provider, "base_url", "")),
            "has_api_key": bool(getattr(provider, "api_key", "")),
            "has_model": bool(getattr(provider, "model", "")),
        }

    def _synthesize_companion_reply(
        self,
        *,
        messages: list[Dict[str, Any]],
        tool_contexts: list[Dict[str, Any]],
        session_id: str,
        temperature: float,
        fallback_content: str,
    ) -> tuple[str, Dict[str, Any]]:
        chat_provider = self.config_store.config.chat_api
        if not self._provider_ready(chat_provider):
            return fallback_content, {
                "choices": [
                    {"message": {"content": fallback_content}, "finish_reason": "stop"}
                ]
            }
        response = request_chat_completion(
            chat_provider,
            self._build_main_chat_messages(messages, tool_contexts, session_id),
            stream=False,
            temperature=temperature,
        )
        content = extract_text_content(response).strip()
        return (content or fallback_content), response

    def _build_action_runtime_messages(
        self,
        messages: list[Dict[str, Any]],
        tool_contexts: list[Dict[str, Any]],
        session_id: str,
    ) -> list[Dict[str, Any]]:
        config = self.config_store.config
        system_parts = [
            "你是行动核（Action Runtime），不是直接对用户说话的伴侣人格。",
            "你的职责是判断是否需要调用工具，并在需要时优先调用工具。",
            "如果用户消息涉及链接、网页、文件、记忆检索、提醒、图片、搜索、外部信息获取，就优先用工具，不要直接假装自己看过。",
            "Trilium 工具只在用户明确提出“笔记/日记/学习笔记/读书笔记/my notes/Trilium”时调用，普通聊天不要调用。",
            "同一轮请求中，同一个提醒只允许创建一次；一旦已经成功创建提醒，不要再次调用 create_reminder。",
            "长期记忆与聊天日志由网关在对话后统一维护，你不要主动调用 save_memory 保存聊天内容。",
            "如需了解用户的长期信息，可以调用 search_memory 检索，但不要把当前对话逐条写入长期记忆。",
            "如果不需要工具，给出极简事实性结论，交给聊天核再润色。",
            "你输出给系统，不输出给最终用户；工具结果会回流给聊天核。",
            f"当前伴侣名称：{config.persona.partner_name}；伴侣身份：{config.persona.partner_role}。",
        ]
        tool_contexts = self._dedupe_tool_contexts(tool_contexts)
        if tool_contexts:
            lines = []
            for index, item in enumerate(tool_contexts, start=1):
                lines.append(
                    f"[{index}] 类型: {item.get('type', 'unknown')}\n链接: {item.get('url', '')}\n备注: {item.get('note', '') or '无'}\n上下文: {item.get('context', '')}"
                )
            system_parts.append(
                "已存在工具上下文如下，可直接利用，无需重复调用同类工具：\n\n"
                + "\n\n".join(lines)
            )
        recent_messages = []
        if session_id:
            recent_messages = self.runtime_store.list_recent_messages(
                session_id,
                limit=max(30, self.config_store.config.session.recent_message_limit),
            )
        if len(messages) > 1:
            recent_messages = []
        return (
            [{"role": "system", "content": "\n".join(system_parts)}]
            + recent_messages
            + messages
        )

    def _chat_tool_specs(
        self, profile_id: str, messages: list[Dict[str, Any]]
    ) -> list[Dict[str, Any]]:
        allow_trilium = self._has_explicit_trilium_intent(messages)
        specs: list[Dict[str, Any]] = []
        for item in self.tools.list_enabled():
            tool_id = str(item.get("id", "") or "")
            if tool_id in {"send_proactive_message", "save_memory"}:
                continue
            if tool_id in {"search_trilium", "get_trilium_note"} and not allow_trilium:
                continue
            specs.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool_id,
                        "description": str(item.get("description", "") or ""),
                        "parameters": item.get("schema")
                        or {"type": "object", "properties": {}},
                    },
                }
            )
        return specs

    def _has_explicit_trilium_intent(self, messages: list[Dict[str, Any]]) -> bool:
        latest_user = ""
        for message in reversed(messages):
            if str(message.get("role", "")) == "user":
                latest_user = str(message.get("content", "") or "").lower()
                break
        if not latest_user:
            return False
        keywords = [
            "my notes",
            "diary note",
            "diary notes",
            "study note",
            "study notes",
            "book note",
            "book notes",
            "trilium",
            "笔记",
            "日记",
            "学习笔记",
            "读书笔记",
            "我的笔记",
        ]
        return any(keyword in latest_user for keyword in keywords)

    def _compact_trilium_search_context(
        self, query: str, result: Dict[str, Any]
    ) -> str:
        status = str(result.get("status", "") or "")
        if status == "trilium_unavailable" or not bool(result.get("ok", False)):
            return "Trilium 当前不可用，已跳过笔记检索。"
        items = result.get("items") or []
        if not items:
            return f"未找到与“{query}”相关的 Trilium 笔记。"
        lines = []
        for index, item in enumerate(items[:3], start=1):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "") or "未命名")
            note_id = str(item.get("noteId", "") or item.get("note_id", "") or "")
            lines.append(f"{index}. {title} (id={note_id})")
        return "Trilium 检索到候选笔记：" + "；".join(lines)

    def _compact_trilium_note_context(self, result: Dict[str, Any]) -> str:
        status = str(result.get("status", "") or "")
        if status == "trilium_unavailable" or not bool(result.get("ok", False)):
            return "Trilium 当前不可用，无法读取笔记内容。"
        if status == "not_found":
            return "未找到该 Trilium 笔记。"
        note = result.get("note") or {}
        title = str(note.get("title", "") or note.get("name", "") or "未命名")
        raw_content = str(result.get("content", "") or "")
        normalized = re.sub(r"\s+", " ", raw_content).strip()
        max_chars = 800
        preview = normalized[:max_chars]
        if len(normalized) > max_chars:
            preview += " …（内容较长，已截断）"
        return f"笔记标题：{title}\n笔记摘要：{preview}".strip()

    def _enrich_tool_arguments(
        self, tool_name: str, arguments: Dict[str, Any], profile_id: str
    ) -> Dict[str, Any]:
        enriched = dict(arguments)
        if tool_name in {
            "create_reminder",
            "send_proactive_message",
        } and not enriched.get("profile_id"):
            enriched["profile_id"] = profile_id
        return enriched

    def _tool_result_to_context(
        self, tool_name: str, arguments: Dict[str, Any], result: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        if tool_name == "search_web":
            return {
                "type": "search",
                "query": str(arguments.get("query", "") or ""),
                "url": "",
                "note": "",
                "context": str(result.get("summary", "") or ""),
                "route_used": str(result.get("route_used", "") or ""),
                "provider_used": str(result.get("provider_used", "") or ""),
            }
        if tool_name == "read_shared_link":
            return {
                "type": "shared_link",
                "url": str(result.get("url", "") or arguments.get("url", "") or ""),
                "note": str(arguments.get("note", "") or ""),
                "context": str(result.get("context", "") or ""),
                "route_used": str(result.get("route_used", "") or ""),
                "provider_used": str(result.get("provider_used", "") or ""),
            }
        if tool_name == "analyze_image":
            return {
                "type": "image",
                "url": str(
                    result.get("url", "")
                    or arguments.get("url", "")
                    or arguments.get("image_url", "")
                    or ""
                ),
                "note": str(arguments.get("note", "") or ""),
                "context": str(result.get("context", "") or ""),
                "route_used": str(result.get("route_used", "") or ""),
                "provider_used": str(result.get("provider_used", "") or ""),
            }
        if tool_name == "search_memory":
            items = result.get("items") or []
            snippets = [
                str(item.get("content", "") or "")[:120]
                for item in items[:5]
                if isinstance(item, dict)
            ]
            return {
                "type": "memory_search",
                "query": str(arguments.get("query", "") or ""),
                "url": "",
                "note": "",
                "context": "\n".join(snippets),
            }
        if tool_name == "search_trilium":
            query = str(arguments.get("query", "") or "")
            return {
                "type": "trilium_search",
                "query": query,
                "url": "",
                "note": "",
                "context": self._compact_trilium_search_context(query, result),
            }
        if tool_name == "get_trilium_note":
            note = result.get("note") or {}
            title = str(note.get("title", "") or note.get("name", "") or "")
            return {
                "type": "trilium_note",
                "query": "",
                "url": "",
                "note": title,
                "context": self._compact_trilium_note_context(result),
            }
        if tool_name == "create_reminder":
            return {
                "type": "reminder",
                "url": "",
                "note": str(arguments.get("content", "") or ""),
                "context": f"已创建提醒：{result.get('content', '')}，触发时间：{result.get('trigger_at', '')}",
            }
        return None

    def handle_feishu_message(self, inbound: Dict[str, Any]) -> Iterable[str]:
        prompt = str(inbound.get("text", "") or "").strip()
        messages = [{"role": "user", "content": prompt}] if prompt else []
        if not messages:
            return []
        profile_id = self._profile_id_for_inbound(inbound)
        _, session = self._resolve_request_session(
            {
                "profile_id": profile_id,
                "channel": "feishu",
                "channel_user_id": inbound.get("open_id", ""),
                "chat_id": inbound.get("chat_id", ""),
                "thread_id": inbound.get("thread_id", ""),
            }
        )
        return self.stream_chat_reply(
            messages=messages,
            profile_id=profile_id,
            session_id=session.session_id,
            channel="feishu",
            temperature=0.7,
            event_type="feishu_chat_respond",
            event_payload={
                "channel": "feishu",
                "open_id": inbound.get("open_id", ""),
                "chat_id": inbound.get("chat_id", ""),
                "chat_type": inbound.get("chat_type", ""),
                "message_id": inbound.get("message_id", ""),
            },
        )

    def handle_napcat_message(self, inbound: Dict[str, Any]) -> Iterable[str]:
        prompt = str(inbound.get("text", "") or "").strip()
        messages = [{"role": "user", "content": prompt}] if prompt else []
        if not messages:
            return []
        profile_id = self._profile_id_for_inbound(inbound)
        _, session = self._resolve_request_session(
            {
                "profile_id": profile_id,
                "channel": "qq",
                "channel_user_id": inbound.get("user_id", ""),
                "chat_id": inbound.get("group_id", ""),
                "thread_id": "",
            }
        )
        return self.stream_chat_reply(
            messages=messages,
            profile_id=profile_id,
            session_id=session.session_id,
            channel="qqbot",
            temperature=0.7,
            event_type="qq_chat_respond",
            event_payload={
                "channel": "qqbot",
                "user_id": inbound.get("user_id", ""),
                "group_id": inbound.get("group_id", ""),
                "message_type": inbound.get("message_type", "private"),
                "message_id": inbound.get("message_id", ""),
            },
        )

    def handle_qqbot_message(self, inbound: Dict[str, Any]) -> Iterable[str]:
        prompt = str(inbound.get("text", "") or "").strip()
        messages = [{"role": "user", "content": prompt}] if prompt else []
        attachments = inbound.get("attachments") or []
        if not messages and attachments:
            messages = [{"role": "user", "content": "[用户发送了图片或文件]"}]
        if not messages and not attachments:
            return []
        profile_id = self._profile_id_for_inbound(inbound)
        _, session = self._resolve_request_session(
            {
                "profile_id": profile_id,
                "channel": "qqbot",
                "channel_user_id": inbound.get("user_id", ""),
                "chat_id": inbound.get("group_id", ""),
                "thread_id": "",
            }
        )
        return self.stream_chat_reply(
            messages=messages,
            attachments=attachments,
            profile_id=profile_id,
            session_id=session.session_id,
            channel="qqbot",
            temperature=0.7,
            event_type="qqbot_chat_respond",
            event_payload={
                "channel": "qqbot",
                "user_id": inbound.get("user_id", ""),
                "group_id": inbound.get("group_id", ""),
                "message_type": inbound.get("message_type", "private"),
                "message_id": inbound.get("message_id", ""),
                "attachments": attachments,
            },
        )

    def _build_feishu_channel(self):
        channels = self.config_store.config.channels
        if not channels.feishu_enabled:
            return None
        if not channels.feishu_app_id or not channels.feishu_app_secret:
            return None
        from .channels.feishu import FeishuChannel, FeishuChannelConfig

        return FeishuChannel(
            FeishuChannelConfig(
                app_id=channels.feishu_app_id,
                app_secret=channels.feishu_app_secret,
                enabled=channels.feishu_enabled,
                auto_reconnect=channels.feishu_auto_reconnect,
                debug=channels.feishu_debug,
                card_title=channels.feishu_card_title,
                patch_interval_ms=channels.feishu_patch_interval_ms,
                patch_min_chars=channels.feishu_patch_min_chars,
            )
        )

    def _build_napcat_channel(self):
        channels = self.config_store.config.channels
        if not channels.napcat_enabled:
            return None
        if not channels.napcat_base_url:
            return None
        from .channels.napcat import NapcatChannel, NapcatChannelConfig

        return NapcatChannel(
            NapcatChannelConfig(
                base_url=channels.napcat_base_url,
                access_token=channels.napcat_access_token,
                enabled=channels.napcat_enabled,
            )
        )

    def _build_qqbot_channel(self):
        channels = self.config_store.config.channels
        if not channels.qqbot_enabled:
            return None
        if not channels.qqbot_app_id or not channels.qqbot_token:
            return None
        from .channels.qqbot import QQBotChannel, QQBotChannelConfig

        return QQBotChannel(
            QQBotChannelConfig(
                app_id=channels.qqbot_app_id,
                token=channels.qqbot_token,
                enabled=channels.qqbot_enabled,
            )
        )

    def _provider_for_request(
        self, provider_name: str, model_override: str = ""
    ) -> Any:
        provider = self._select_provider(provider_name)
        if model_override and getattr(provider, "model", "") != model_override:
            provider = copy.deepcopy(provider)
            provider.model = model_override
        return provider

    def _select_provider(self, provider_name: str) -> Any:
        provider_name = provider_name.lower().strip()
        if provider_name == "search":
            return self.config_store.config.search_api
        if provider_name == "action":
            return self.config_store.config.action_api
        return self.config_store.config.chat_api

    def _coerce_messages(self, body: Dict[str, Any]) -> list[Dict[str, str]]:
        messages = body.get("messages") or []
        prompt = str(body.get("prompt", "") or "").strip()
        if prompt and not messages:
            messages = [{"role": "user", "content": prompt}]
        if not messages:
            raise ValueError("messages or prompt is required")
        return messages

    def _build_main_chat_messages(
        self,
        messages: list[Dict[str, Any]],
        tool_contexts: list[Dict[str, Any]],
        session_id: str = "",
    ) -> list[Dict[str, Any]]:
        config = self.config_store.config
        local_now = datetime.now().astimezone()
        system_parts = [
            f"你是用户的 {config.persona.partner_role}，名字是 {config.persona.partner_name}。",
            f"说话风格：{config.persona.core_identity}",
            f"边界要求：{config.persona.boundaries}",
            f"（参考信息）当前服务器本地时间：{local_now.isoformat(timespec='seconds')}。请以这个本地时间判断现在是白天、夜晚、工作日还是周末。",
            "如果用户提到绝对时间但没有注明时区或 UTC 偏移，请按服务器本地时间理解。",
            "你是唯一直接对用户说话的模型。工具层、搜索层、识图层都只能给你补充上下文，不能替你发言。",
            "默认先用工具层/行动层完成搜索、读链接、识图、记忆检索和提醒创建；只有工具失败、未配置，或纯陪伴聊天不需要工具时，才由你直接兜底回答。",
            "只有当用户明确提到日记、学习笔记、读书笔记、Trilium 或“我的笔记”时，才使用 Trilium 工具；普通闲聊不要触发。",
            "使用 Trilium 时先调用 search_trilium，确认候选后再调用 get_trilium_note。",
        ]
        core_profile = self._read_text_file(self._core_memory_file())
        active_memory = self._read_text_file(self._active_memory_file())
        if core_profile:
            system_parts.append(
                "以下是核心档案，请将其视为稳定关系背景。\n\n" + core_profile
            )
        if active_memory:
            system_parts.append(
                "以下是近期活跃记忆，请在相关时自然接住。\n\n" + active_memory
            )
        recent_daily_logs = self._render_recent_daily_logs_context()
        if recent_daily_logs:
            system_parts.append(
                "以下是最近两天的日志摘要，仅在相关时自然吸收，不要逐句复述。\n\n" + recent_daily_logs
            )
        tool_contexts = self._dedupe_tool_contexts(tool_contexts, active_memory + "\n" + recent_daily_logs)
        if tool_contexts:
            context_lines = []
            for index, item in enumerate(tool_contexts, start=1):
                context_lines.append(
                    f"[{index}] 类型: {item.get('type', 'unknown')}\n链接: {item.get('url', '')}\n用户备注: {item.get('note', '') or '无'}\n工具整理上下文: {item.get('context', '')}"
                )
            system_parts.append(
                "以下是工具层提供的附加上下文。仅在相关时自然吸收，不要生硬复述，也不要提及这是工具、抓取或系统注入的内容。\n\n"
                + "\n\n".join(context_lines)
            )
        recent_messages = []
        if session_id:
            recent_messages = self.runtime_store.list_recent_messages(
                session_id,
                limit=self.config_store.config.session.recent_message_limit,
            )
        if len(messages) > 1:
            recent_messages = []
        return (
            [{"role": "system", "content": "\n".join(system_parts)}]
            + recent_messages
            + messages
        )

    def _prepare_tool_contexts(
        self,
        messages: list[Dict[str, Any]],
        attachments: list[Dict[str, Any]],
        search_query: str,
    ) -> list[Dict[str, Any]]:
        tool_contexts = []
        seen_urls: set[str] = set()
        if search_query:
            context = prepare_search_context(self.config_store.config, search_query)
            tool_contexts.append(context)
            self._record_event(
                "tool_execute",
                {
                    "tool": "search_web",
                    "query": search_query,
                    "route_used": context.get("route_used", ""),
                },
            )
        for url in self._extract_urls_from_messages(messages):
            if url in seen_urls:
                continue
            seen_urls.add(url)
            try:
                context = prepare_shared_link_context(self.config_store.config, url, "")
            except Exception as error:
                context = {
                    "type": "shared_link",
                    "url": url,
                    "note": "",
                    "excerpt": "",
                    "context": f"链接预处理失败：{error}",
                    "route_used": "failed",
                    "provider_used": "none",
                }
            tool_contexts.append(context)
            self._record_event(
                "tool_execute",
                {
                    "tool": "read_shared_link",
                    "url": url,
                    "route_used": context.get("route_used", ""),
                },
            )
        for attachment in attachments:
            attachment_type = str(attachment.get("type", "") or "").strip().lower()
            if attachment_type in {"url", "link", "shared_link"}:
                url = str(attachment.get("url", "") or "").strip()
                note = str(attachment.get("note", "") or "").strip()
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    try:
                        context = prepare_shared_link_context(
                            self.config_store.config, url, note
                        )
                    except Exception as error:
                        context = {
                            "type": "shared_link",
                            "url": url,
                            "note": note,
                            "excerpt": "",
                            "context": f"链接预处理失败：{error}",
                            "route_used": "failed",
                            "provider_used": "none",
                        }
                    tool_contexts.append(context)
                    self._record_event(
                        "tool_execute",
                        {
                            "tool": "read_shared_link",
                            "url": url,
                            "route_used": context.get("route_used", ""),
                        },
                    )
            if attachment_type in {"image", "image_url", "photo"}:
                image_url = str(
                    attachment.get("url", "") or attachment.get("image_url", "") or ""
                ).strip()
                image_key = str(attachment.get("image_key", "") or "").strip()
                note = str(attachment.get("note", "") or "").strip()
                source = str(attachment.get("source", "") or "").strip().lower()
                message_id = str(attachment.get("message_id", "") or "").strip()
                if not image_url and image_key and source == "feishu" and message_id and self.feishu_channel:
                    try:
                        tmp_dir = self.root / "data" / "tmp" / "feishu"
                        image_url = self.feishu_channel.download_message_resource(
                            message_id, "image", image_key, str(tmp_dir)
                        )
                    except Exception as error:
                        tool_contexts.append(
                            {
                                "type": "image",
                                "url": "",
                                "note": note,
                                "context": f"飞书图片下载失败：{error}",
                                "route_used": "failed",
                                "provider_used": "none",
                            }
                        )
                if image_url:
                    context = prepare_image_context(
                        self.config_store.config, image_url, note, self.root
                    )
                    tool_contexts.append(context)
                    self._record_event(
                        "tool_execute",
                        {
                            "tool": "analyze_image",
                            "url": image_url,
                            "route_used": context.get("route_used", ""),
                        },
                    )
            if attachment_type in {"search", "web_search"}:
                query = str(
                    attachment.get("query", "") or attachment.get("text", "") or ""
                ).strip()
                if query:
                    context = prepare_search_context(self.config_store.config, query)
                    tool_contexts.append(context)
                    self._record_event(
                        "tool_execute",
                        {
                            "tool": "search_web",
                            "query": query,
                            "route_used": context.get("route_used", ""),
                        },
                    )
        return tool_contexts

    def _extract_urls_from_messages(self, messages: list[Dict[str, Any]]) -> list[str]:
        urls: list[str] = []
        pattern = re.compile(r"https?://[^\s<>()\[\]{}\"']+")
        for message in messages:
            if str(message.get("role", "") or "") != "user":
                continue
            content = message.get("content", "")
            if isinstance(content, str):
                urls.extend(pattern.findall(content))
        return urls

    def list_memories_grouped(self, category: str = "") -> Dict[str, Any]:
        records = [
            self._serialize_memory(record)
            for record in self.memory_store.list_memories(
                limit=1000, memory_kind="long_term"
            )
            if getattr(record, "category", "") != "memory_refresh"
        ]
        if category:
            items = [item for item in records if item["category"] == category]
            return {"category": category, "items": items}
        grouped: Dict[str, Any] = {
            name: []
            for name in [
                "anniversary",
                "preference",
                "promise",
                "story",
                "other",
                "password",
                "travel",
            ]
        }
        for item in records:
            grouped.setdefault(item["category"], []).append(item)
        grouped["items"] = records
        grouped["stats"] = {
            key: len(value)
            for key, value in grouped.items()
            if isinstance(value, list) and key != "items"
        }
        return grouped

    def list_daily_logs_payload(
        self, profile_id: str = "", session_id: str = "", limit: int = 60
    ) -> Dict[str, Any]:
        records = [
            self._serialize_memory(record)
            for record in self.memory_store.list_memories(
                limit=max(1, min(limit, 365)), memory_kind="daily_log"
            )
        ]
        items = records
        if profile_id:
            items = [item for item in items if item.get("profile_id") == profile_id]
        if session_id:
            items = [item for item in items if item.get("session_id") == session_id]
        return {
            "profile_id": profile_id,
            "session_id": session_id,
            "items": items,
            "stats": {"total": len(items)},
        }

    def search_memories_payload(self, query: str) -> Dict[str, Any]:
        items = (
            [
                self._serialize_memory(record)
                for record in self.memory_store.search(query)
                if getattr(record, "category", "") != "memory_refresh"
            ]
            if query
            else []
        )
        return {"query": query, "items": items, "results": items}

    def list_sessions_payload(self, profile_id: str = "") -> Dict[str, Any]:
        sessions = self.runtime_store.list_sessions(profile_id=profile_id, limit=50)
        return {
            "profile_id": profile_id,
            "items": [session.__dict__ for session in sessions],
        }

    def list_events_payload(
        self, profile_id: str = "", session_id: str = "", limit: int = 50
    ) -> Dict[str, Any]:
        return {
            "profile_id": profile_id,
            "session_id": session_id,
            "items": self.runtime_store.list_events(
                profile_id=profile_id, session_id=session_id, limit=limit
            ),
        }

    def list_reminders_payload(
        self, profile_id: str = "", status: str = ""
    ) -> Dict[str, Any]:
        items = [
            self._serialize_reminder(record)
            for record in self.runtime_store.list_reminders(
                profile_id=profile_id, status=status
            )
        ]
        return {"profile_id": profile_id, "status": status, "items": items}

    def create_reminder_payload(self, body: Dict[str, Any]) -> Dict[str, Any]:
        profile_id = str(body.get("profile_id", "local-user") or "local-user").strip()
        content = str(body.get("content", "") or body.get("reason", "")).strip()
        if not content:
            raise ValueError("content is required")
        trigger_at = str(body.get("trigger_at", "") or "").strip()
        if not trigger_at:
            minutes = int(body.get("minutes", 0) or 0)
            if minutes <= 0:
                raise ValueError("trigger_at or minutes is required")
            trigger_at = datetime.utcfromtimestamp(
                datetime.utcnow().timestamp() + minutes * 60
            ).isoformat()
        reminder = self.runtime_store.create_reminder(
            reminder_id=f"rem_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            profile_id=profile_id,
            content=content,
            trigger_at=trigger_at,
            channel=str(body.get("channel", "") or "").strip(),
            metadata=body.get("metadata") or {},
        )
        self._record_event(
            "reminder_created",
            {
                "content": content,
                "trigger_at": trigger_at,
                "metadata": reminder.metadata,
            },
            profile_id=profile_id,
        )
        return {"item": self._serialize_reminder(reminder)}

    def delete_reminder_payload(self, reminder_id: str) -> Dict[str, Any]:
        reminder = self.runtime_store.get_reminder(reminder_id)
        deleted = self.runtime_store.delete_reminder(reminder_id)
        if not deleted:
            raise KeyError("reminder not found")
        self._record_event(
            "reminder_deleted",
            {"reminder_id": reminder_id},
            profile_id=reminder.profile_id,
        )
        return {"success": True, "deleted": self._serialize_reminder(reminder)}

    def list_mcp_servers_payload(self) -> Dict[str, Any]:
        bridge_tools = []
        for item in self.tools.list_enabled():
            if item["id"] == "call_mcp":
                bridge_tools.append(item)
        return {
            "servers": self.tools.execute("call_mcp", {"server": "", "tool": ""})
            if False
            else [],
            "gateway_tools": bridge_tools,
            "configured_servers": [
                {
                    "name": server.name,
                    "enabled": server.enabled,
                    "command": server.command,
                    "args": server.args,
                }
                for server in self.config_store.config.mcp_servers
            ],
        }

    def dispatch_proactive_message(
        self, profile_id: str, content: str, source: str = "proactive"
    ) -> Dict[str, Any]:
        profile = self.runtime_store.profile_state(profile_id)
        channel = str(profile.get("last_channel", "") or "")
        outbound_content = self._prepare_outbound_message(profile_id, content, source)
        delivered = False
        note = ""
        if channel == "feishu" and self.feishu_channel is not None:
            open_id = str(profile.get("channel_user_id", "") or "")
            chat_id = str(profile.get("chat_id", "") or "")
            chat_type = "p2p" if not chat_id else "group"
            self.feishu_channel.send_text(
                open_id, outbound_content, chat_id=chat_id, chat_type=chat_type
            )
            delivered = True
        elif channel == "qqbot" and self.qqbot_channel is not None:
            user_id = str(profile.get("channel_user_id", "") or "")
            group_id = str(profile.get("chat_id", "") or "")
            message_type = "group" if group_id else "private"
            self.qqbot_channel.send_text(
                user_id,
                outbound_content,
                group_id=group_id,
                message_type=message_type,
                attachments=self._extract_outbound_attachments(content),
            )
            delivered = True
        elif channel == "qq" and self.napcat_channel is not None:
            user_id = str(profile.get("channel_user_id", "") or "")
            group_id = str(profile.get("chat_id", "") or "")
            message_type = "group" if group_id else "private"
            self.napcat_channel.send_text(
                user_id, outbound_content, group_id=group_id, message_type=message_type
            )
            delivered = True
        else:
            note = "no live outbound channel was available; event recorded only"
        self._record_event(
            source,
            {
                "content": outbound_content,
                "raw_content": content,
                "delivered": delivered,
                "note": note,
            },
            profile_id=profile_id,
            session_id=str(profile.get("last_session_id", "") or ""),
            channel=channel,
        )
        return {
            "profile_id": profile_id,
            "content": outbound_content,
            "raw_content": content,
            "delivered": delivered,
            "note": note,
            "channel": channel,
        }

    def _extract_outbound_attachments(self, raw_content: str) -> list[Dict[str, Any]]:
        text = str(raw_content or "")
        attachments: list[Dict[str, Any]] = []
        image_matches = re.findall(
            r"<qqimg>(.*?)</(?:qqimg|img)>", text, flags=re.I | re.S
        )
        file_matches = re.findall(r"<qqfile>(.*?)</qqfile>", text, flags=re.I | re.S)
        for item in image_matches:
            value = item.strip()
            if value:
                attachments.append(
                    {"type": "image", "url": value, "name": Path(value).name}
                )
        for item in file_matches:
            value = item.strip()
            if value:
                attachments.append(
                    {"type": "file", "url": value, "name": Path(value).name}
                )
        return attachments

    def _prepare_outbound_message(
        self, profile_id: str, content: str, source: str
    ) -> str:
        return self._synthesize_outbound_message(profile_id, content, source)

    def _synthesize_outbound_message(
        self, profile_id: str, content: str, source: str
    ) -> str:
        chat_provider = self.config_store.config.chat_api
        if not self._provider_ready(chat_provider):
            return content
        profile = self.runtime_store.profile_state(profile_id)
        session_id = str(profile.get("last_session_id", "") or "")
        system = (
            "你是伴侣聊天核。现在不是普通对话，而是在把系统事件转写成自然、亲密、不突兀的一条消息。"
            "不要提系统、调度器、提醒服务、自动发送。"
            "保留原意，写得像她/他自己主动说出来的一句话。"
        )
        user = f"事件类型：{source}\n原始内容：{content}"
        try:
            response = request_chat_completion(
                chat_provider,
                self._build_main_chat_messages(
                    [{"role": "user", "content": user}],
                    [],
                    session_id,
                )[:-1]
                + [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                stream=False,
                temperature=0.7,
            )
            text = extract_text_content(response).strip()
            return text or content
        except Exception:
            return content

    def upsert_panel_memory(
        self, body: Dict[str, Any], memory_id: str = ""
    ) -> Dict[str, Any]:
        raw_id = (
            memory_id
            or str(body.get("id", "") or "")
            or f"mem_{len(self.memory_store.list_memories(1000)) + 1}"
        )
        title = str(body.get("title", "") or body.get("key", "") or "untitled")
        record = self.memory_store.upsert_memory(
            memory_id=raw_id,
            key=title,
            content=str(body.get("content", "") or ""),
            memory_kind="long_term",
            category=str(body.get("category", "other") or "other"),
            importance=float(body.get("importance", 0.5) or 0.5),
            session_id=str(body.get("session_id", "") or ""),
            embedding=body.get("embedding") or [],
        )
        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        return {"item": self._serialize_memory(record)}

    def delete_panel_memory(self, memory_id: str) -> Dict[str, Any]:
        existing = self.memory_store.get_memory(memory_id)
        if existing is None:
            raise KeyError("memory not found")
        self.memory_store.delete_memory(memory_id)
        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        return {
            "success": True,
            "deleted": self._serialize_memory(existing),
            "category": existing.category,
        }

    def clear_panel_memories(self) -> Dict[str, Any]:
        deleted = self.memory_store.delete_memories(["long_term", "daily_log"])
        self._ensure_context_files(refresh=True)
        self._ensure_digest_run_state_file()
        return {
            "success": True,
            "deleted": deleted,
            "memory_kinds": ["long_term", "daily_log"],
        }

    def get_context_payload(self) -> Dict[str, Any]:
        return {
            "core_profile": self._read_text_file(self._core_memory_file()),
            "active_memory": self._read_text_file(self._active_memory_file()),
        }

    def _resolve_request_session(self, body: Dict[str, Any]) -> tuple[str, Any]:
        profile_id = str(body.get("profile_id", "local-user") or "local-user").strip()
        session = self.runtime_store.resolve_session(
            profile_id=profile_id,
            channel=str(body.get("channel", "web") or "web").strip(),
            channel_user_id=str(body.get("channel_user_id", "") or "").strip(),
            chat_id=str(body.get("chat_id", "") or "").strip(),
            thread_id=str(body.get("thread_id", "") or "").strip(),
            idle_rotation_minutes=self.config_store.config.session.idle_rotation_minutes,
        )
        return profile_id, session

    def _append_messages_to_session(
        self,
        session_id: str,
        profile_id: str,
        messages: list[Dict[str, str]],
        response: str,
        *,
        channel: str,
    ) -> None:
        for message in messages:
            role = str(message.get("role", "") or "").strip()
            content = str(message.get("content", "") or "").strip()
            if role in {"user", "assistant"} and content:
                self.runtime_store.append_message(
                    session_id=session_id,
                    profile_id=profile_id,
                    role=role,
                    content=content,
                    channel=channel,
                )
        if response.strip():
            self.runtime_store.append_message(
                session_id=session_id,
                profile_id=profile_id,
                role="assistant",
                content=response.strip(),
                channel=channel,
            )

    def _record_event(
        self,
        event_type: str,
        payload: Dict[str, Any],
        *,
        profile_id: str = "",
        session_id: str = "",
        channel: str = "",
    ) -> None:
        self.memory_store.add_event(event_type, payload)
        self.runtime_store.add_event(
            event_type,
            payload,
            profile_id=profile_id,
            session_id=session_id,
            channel=channel,
        )

    def _serialize_reminder(self, record: Any) -> Dict[str, Any]:
        return {
            "id": record.reminder_id,
            "profile_id": record.profile_id,
            "content": record.content,
            "trigger_at": record.trigger_at,
            "status": record.status,
            "channel": record.channel,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "delivered_at": record.delivered_at,
            "metadata": record.metadata,
        }

    def _deliver_due_reminder(self, reminder_id: str) -> None:
        reminder = self.runtime_store.get_reminder(reminder_id)
        reminder_prompt = (
            "这是一个已到时间的提醒，请先理解提醒意图，再以你自己的语气自然发给用户。"
            "不要原样转抄，不要提系统、定时器、提醒服务或自动发送。"
            f"\n提醒内容：{reminder.content}"
        )
        result = self.dispatch_proactive_message(
            reminder.profile_id, reminder_prompt, "scheduled_reminder"
        )
        if result.get("delivered"):
            self.runtime_store.mark_reminder_delivered(reminder_id)
        self._refresh_active_memory()

    def _send_idle_proactive_ping(self, profile_id: str) -> None:
        profile = self.runtime_store.profile_state(profile_id)
        if not profile:
            return
        scheduler = self.config_store.config.scheduler
        last_interaction_at = str(profile.get("last_interaction_at", "") or "").strip()
        idle_text = "有一阵子"
        idle_minutes = 0
        if last_interaction_at:
            try:
                idle_delta = datetime.utcnow() - datetime.fromisoformat(
                    last_interaction_at
                )
                idle_minutes = max(int(idle_delta.total_seconds() // 60), 0)
                idle_text = self._format_idle_duration(idle_minutes)
            except ValueError:
                idle_text = "有一阵子"
        current_hour = datetime.now().hour
        content = (
            "这是一次白天时段的主动消息判断。"
            f"现在是本地时间 {current_hour:02d}:00，处于允许主动消息的白天窗口"
            f"（{scheduler.proactive_day_start_hour}:00-{scheduler.proactive_day_end_hour}:00）。"
            f"距离用户上次发来消息已经约 {idle_text}"
            f"（约 {idle_minutes} 分钟）。"
            "请基于你和对方最近的上下文，主动发一条自然、简短、像真人顺手关心一下的消息。"
            "不要提系统、定时、空闲阈值、主动触发、已经多久没回复这些内部原因。"
            "如果缺少上下文，也发一条轻松自然的问候，不要显得突兀。"
        )
        self.dispatch_proactive_message(profile_id, content, "idle_proactive_ping")
        self.runtime_store.mark_proactive_sent(profile_id)
        self._refresh_active_memory()

    def _format_idle_duration(self, total_minutes: int) -> str:
        minutes = max(int(total_minutes), 0)
        days, rem = divmod(minutes, 1440)
        hours, mins = divmod(rem, 60)
        parts: list[str] = []
        if days > 0:
            parts.append(f"{days}天")
        if hours > 0:
            parts.append(f"{hours}小时")
        if mins > 0 or not parts:
            parts.append(f"{mins}分钟")
        return "".join(parts)

    def _profile_id_for_inbound(self, inbound: Dict[str, Any]) -> str:
        channel = str(inbound.get("channel", "") or "").strip().lower()
        if channel == "qq":
            group_id = str(inbound.get("group_id", "") or "").strip()
            user_id = str(inbound.get("user_id", "") or "").strip()
            if group_id:
                return f"qq-group:{group_id}"
            if user_id:
                return f"qq:{user_id}"
            return "qq:anonymous"
        if channel == "qqbot":
            group_id = str(inbound.get("group_id", "") or "").strip()
            user_id = str(inbound.get("user_id", "") or "").strip()
            if group_id:
                return f"qqbot-group:{group_id}"
            if user_id:
                return f"qqbot:{user_id}"
            return "qqbot:anonymous"
        open_id = str(inbound.get("open_id", "") or "").strip()
        if open_id:
            return f"feishu:{open_id}"
        chat_id = str(inbound.get("chat_id", "") or "").strip()
        if chat_id:
            return f"feishu-chat:{chat_id}"
        return "feishu:anonymous"

    def resolve_static_path(self, request_path: str) -> Optional[Path]:
        if self.dashboard_root is None:
            return None
        relative = request_path.lstrip("/") or "index.html"
        candidate = (self.dashboard_root / relative).resolve()
        if not str(candidate).startswith(str(self.dashboard_root.resolve())):
            return None
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if candidate.exists() and candidate.is_file():
            return candidate
        if "." not in relative:
            fallback = (self.dashboard_root / "index.html").resolve()
            if fallback.exists():
                return fallback
        return None

    def _serialize_memory(self, record: Any) -> Dict[str, Any]:
        profile_id = ""
        if isinstance(record.session_id, str) and ":" in record.session_id:
            profile_id = record.session_id.rsplit(":", 1)[0]
        return {
            "id": record.id,
            "title": record.key,
            "key": record.key,
            "content": record.content,
            "memory_kind": getattr(record, "memory_kind", "long_term"),
            "category": record.category,
            "importance": record.importance,
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
            "date": record.created_at[:10] if record.created_at else "",
            "source": "gateway",
            "session_id": record.session_id,
            "profile_id": profile_id,
            "final_score": getattr(record, "final_score", 0.0),
        }

    def _find_dashboard_root(self) -> Optional[Path]:
        candidates = [
            self.root.parent / "saki-phone" / "web",
            self.root.parent / "saki-phone",
        ]
        for candidate in candidates:
            if (candidate / "index.html").exists():
                return candidate.resolve()
        return None

    def _ensure_context_files(self, refresh: bool = False) -> None:
        core_file = self._core_memory_file()
        active_file = self._active_memory_file()
        core_file.parent.mkdir(parents=True, exist_ok=True)
        active_file.parent.mkdir(parents=True, exist_ok=True)
        if refresh or not core_file.exists():
            self._write_text_file(core_file, self._render_core_profile())
        if refresh or not active_file.exists():
            self._write_text_file(active_file, self._render_active_memory())

    def _core_memory_file(self) -> Path:
        return self._core_memory_path

    def _active_memory_file(self) -> Path:
        return self._hot_memory_path

    def _digest_run_state_file(self) -> Path:
        return self._digest_run_state_path

    def _default_digest_run_state(self) -> Dict[str, str]:
        return {
            "id": "",
            "run_state": "idle",
            "status": "not_started",
            "started_at": "",
            "completed_at": "",
            "error_message": "",
        }

    def _ensure_digest_run_state_file(self) -> None:
        path = self._digest_run_state_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return
        self._write_text_file(
            path,
            json.dumps(self._default_digest_run_state(), ensure_ascii=False, indent=2) + "\n",
        )

    def _read_digest_run_state(self) -> Dict[str, str]:
        path = self._digest_run_state_file()
        raw = self._read_text_file(path)
        if not raw:
            return self._default_digest_run_state()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return self._default_digest_run_state()
        state = self._default_digest_run_state()
        if isinstance(payload, dict):
            for key in state:
                state[key] = str(payload.get(key, state[key]) or "")
        return state

    def _write_digest_run_state(self, state: Dict[str, str]) -> None:
        payload = self._default_digest_run_state()
        for key in payload:
            payload[key] = str(state.get(key, payload[key]) or "")
        self._write_text_file(
            self._digest_run_state_file(),
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )

    def _resolve_local_timezone_name(self) -> str:
        configured = str(self.config_store.config.scheduler.local_timezone or "").strip()
        if configured:
            try:
                ZoneInfo(configured)
                return configured
            except Exception:
                pass
        fallback = datetime.now().astimezone().tzinfo
        key = getattr(fallback, "key", "") or str(fallback or "")
        return key or "local"

    def _now_in_local_timezone(self) -> datetime:
        timezone_name = self._resolve_local_timezone_name()
        try:
            return datetime.now(ZoneInfo(timezone_name))
        except Exception:
            return datetime.now().astimezone()

    def _normalize_core_proposal_content(self, value: str) -> str:
        lines = []
        for raw in str(value or "").splitlines():
            line = raw.strip()
            line = re.sub(r"^[#>*-]+\s*", "", line)
            line = re.sub(r"\s+", " ", line).strip()
            if line:
                lines.append(line)
        return "\n".join(lines).strip()

    def _core_proposal_fingerprint(self, target_section: str, proposed_content: str) -> str:
        normalized_section = str(target_section or "").strip().casefold()
        normalized_content = self._normalize_core_proposal_content(proposed_content).casefold()
        raw = f"{normalized_section}\n{normalized_content}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _create_core_update_proposal(
        self,
        *,
        target_section: str,
        proposed_content: str,
        reason: str,
        source_context: str,
        proposal_type: str = "",
        confidence: str = "medium",
    ) -> Dict[str, Any]:
        section = str(target_section or "").strip()
        if section not in self.CORE_PROFILE_SECTIONS:
            return {"ok": False, "reason": "invalid_target_section", "target_section": section}
        normalized_content = self._normalize_core_proposal_content(proposed_content)
        if not normalized_content:
            return {"ok": False, "reason": "empty_content", "target_section": section}
        normalized_type = str(proposal_type or "").strip().lower()
        allowed_types = {"identity", "preference", "goal", "relationship", "routine", "other"}
        if normalized_type not in allowed_types:
            normalized_type = "other"
        normalized_confidence = str(confidence or "").strip().lower()
        if normalized_confidence not in {"low", "medium", "high"}:
            normalized_confidence = "medium"
        fingerprint = self._core_proposal_fingerprint(section, normalized_content)
        before = self.memory_store.list_core_updates(status="open", limit=500)
        before_ids = {item.id for item in before if item.fingerprint == fingerprint}
        proposal = self.memory_store.create_or_touch_core_update(
            target_section=section,
            proposed_content=normalized_content,
            reason=str(reason or "core update candidate"),
            source_context=str(source_context or ""),
            fingerprint=fingerprint,
            proposal_type=normalized_type,
            confidence=normalized_confidence,
        )
        created = proposal.id not in before_ids
        return {
            "ok": True,
            "created": created,
            "proposal_id": proposal.id,
            "fingerprint": proposal.fingerprint,
            "proposal_type": proposal.proposal_type,
            "confidence": proposal.confidence,
            "status": proposal.status,
            "target_section": proposal.target_section,
        }

    def list_open_core_update_proposals(self, limit: int = 50) -> Dict[str, Any]:
        items = self.memory_store.list_core_updates(status="open", limit=limit)
        return {
            "items": [
                {
                    "id": item.id,
                    "target_section": item.target_section,
                    "proposed_content": item.proposed_content,
                    "reason": item.reason,
                    "source_context": item.source_context,
                    "fingerprint": item.fingerprint,
                    "proposal_type": item.proposal_type,
                    "confidence": item.confidence,
                    "status": item.status,
                    "created_at": item.created_at,
                    "updated_at": item.updated_at,
                    "reviewed_at": item.reviewed_at,
                }
                for item in items
            ]
        }

    def _core_section_memory_identity(self, section: str) -> tuple[str, str]:
        section_slug = re.sub(r"[^a-z0-9]+", "_", section.lower()).strip("_") or "my_profile"
        return f"core_section::{section_slug}", f"core_profile_{section_slug}"

    def _normalize_merge_entry(self, value: str) -> str:
        normalized = self._normalize_core_proposal_content(value)
        normalized = re.sub(r"^[\-•*]\s*", "", normalized).strip()
        return normalized

    def _entry_similarity(self, left: str, right: str) -> float:
        left_tokens = {token for token in re.split(r"\W+", left.casefold()) if token}
        right_tokens = {token for token in re.split(r"\W+", right.casefold()) if token}
        if not left_tokens or not right_tokens:
            return 0.0
        intersection = len(left_tokens & right_tokens)
        union = len(left_tokens | right_tokens)
        return float(intersection) / float(union or 1)

    def _is_conflicting_entry(self, existing: str, incoming: str) -> bool:
        parts_existing = [part.strip() for part in existing.split(":", 1)]
        parts_incoming = [part.strip() for part in incoming.split(":", 1)]
        if len(parts_existing) == 2 and len(parts_incoming) == 2 and parts_existing[0].casefold() == parts_incoming[0].casefold():
            return parts_existing[1].casefold() != parts_incoming[1].casefold()
        if self._entry_similarity(existing, incoming) >= 0.55:
            neg_tokens = ["不", "不要", "not", "never", "no"]
            existing_neg = any(token in existing.casefold() for token in neg_tokens)
            incoming_neg = any(token in incoming.casefold() for token in neg_tokens)
            return existing_neg != incoming_neg
        return False

    def _merge_core_section_entries(
        self,
        *,
        section: str,
        incoming_entry: str,
        proposal_type: str,
        confidence: str,
    ) -> Dict[str, Any]:
        memory_id, category = self._core_section_memory_identity(section)
        existing = self.memory_store.get_memory(memory_id)
        current_lines = []
        if existing and existing.content:
            current_lines = [
                self._normalize_merge_entry(line)
                for line in str(existing.content).splitlines()
                if self._normalize_merge_entry(line)
            ]
        incoming = self._normalize_merge_entry(incoming_entry)
        if not incoming:
            return {"changed": False, "reason": "empty_incoming", "memory_id": memory_id}
        for line in current_lines:
            if line.casefold() == incoming.casefold() or self._entry_similarity(line, incoming) >= 0.85:
                return {"changed": False, "reason": "duplicate", "memory_id": memory_id}
            if self._is_conflicting_entry(line, incoming):
                return {"changed": False, "reason": "conflict", "memory_id": memory_id}
        if len(current_lines) >= 12:
            current_lines = current_lines[:11]
        current_lines.append(incoming)
        merged_content = "\n".join(f"- {line}" for line in current_lines)
        key = f"{section} merged ({proposal_type}/{confidence})"
        self.memory_store.upsert_memory(
            memory_id=memory_id,
            key=key,
            content=merged_content,
            memory_kind="long_term",
            category=category,
            importance=1.0,
            session_id="core-update-review",
        )
        return {"changed": True, "reason": "merged", "memory_id": memory_id}

    def _apply_approved_core_update(self, proposal: Any) -> Dict[str, Any]:
        section = str(proposal.target_section)
        merge_result = self._merge_core_section_entries(
            section=section,
            incoming_entry=str(proposal.proposed_content),
            proposal_type=str(getattr(proposal, "proposal_type", "other") or "other"),
            confidence=str(getattr(proposal, "confidence", "medium") or "medium"),
        )
        if merge_result.get("changed"):
            self._write_text_file(self._core_memory_file(), self._render_core_profile())
        return merge_result

    def approve_core_update_proposal(self, proposal_id: str) -> Dict[str, Any]:
        proposal = self.memory_store.get_core_update(proposal_id)
        if proposal is None:
            return {"ok": False, "reason": "proposal_not_found"}
        if proposal.status != "open":
            return {"ok": False, "reason": "proposal_not_open", "status": proposal.status}
        merge_result = self._apply_approved_core_update(proposal)
        updated = self.memory_store.update_core_update_status(proposal_id, "approved")
        self.record_event(
            "core_update_review",
            {
                "decision": "approved",
                "proposal_id": proposal_id,
                "target_section": proposal.target_section,
                "merge_result": merge_result,
            },
        )
        return {"ok": True, "proposal": {"id": updated.id, "status": updated.status, "reviewed_at": updated.reviewed_at}}

    def reject_core_update_proposal(self, proposal_id: str) -> Dict[str, Any]:
        proposal = self.memory_store.get_core_update(proposal_id)
        if proposal is None:
            return {"ok": False, "reason": "proposal_not_found"}
        if proposal.status != "open":
            return {"ok": False, "reason": "proposal_not_open", "status": proposal.status}
        updated = self.memory_store.update_core_update_status(proposal_id, "rejected")
        self.record_event(
            "core_update_review",
            {"decision": "rejected", "proposal_id": proposal_id, "target_section": proposal.target_section},
        )
        return {"ok": True, "proposal": {"id": updated.id, "status": updated.status, "reviewed_at": updated.reviewed_at}}

    def _categorize_core_update_target(self, item: Dict[str, Any]) -> str:
        category = str(item.get("category", "") or "").strip().lower()
        key = str(item.get("key", "") or "").strip().lower()
        if category in {"identity", "boundary"} or any(token in key for token in ["伴侣", "名字", "身份", "气质", "边界"]):
            return "About Her" if category != "boundary" else "Relationship Core"
        if category in {"relationship", "promise", "anniversary"}:
            return "Relationship Core"
        if category in {"preference", "habit", "event"}:
            return "My Profile"
        return ""

    def _classify_proposal_metadata(self, item: Dict[str, Any]) -> tuple[str, str]:
        category = str(item.get("category", "") or "").strip().lower()
        importance = float(item.get("importance", 0.5) or 0.5)
        proposal_type = "other"
        if category in {"identity", "boundary"}:
            proposal_type = "identity"
        elif category in {"relationship", "promise", "anniversary"}:
            proposal_type = "relationship"
        elif category in {"preference"}:
            proposal_type = "preference"
        elif category in {"habit", "routine"}:
            proposal_type = "routine"
        elif category in {"goal", "event"}:
            proposal_type = "goal"
        confidence = "high" if importance >= 0.8 else "medium" if importance >= 0.4 else "low"
        return proposal_type, confidence

    def _sanitize_memory_line(self, value: str, max_chars: int) -> str:
        compact = " ".join(str(value or "").split())
        if len(compact) <= max_chars:
            return compact
        return compact[: max(0, max_chars - 1)].rstrip() + "…"

    def _render_memory_section(
        self,
        title: str,
        lines: list[str],
        *,
        max_items: int,
        max_chars_per_item: int,
        fallback: str,
    ) -> str:
        section_lines = [f"## {title}"]
        kept = 0
        for line in lines:
            sanitized = self._sanitize_memory_line(line, max_chars_per_item)
            if not sanitized:
                continue
            section_lines.append(f"- {sanitized}")
            kept += 1
            if kept >= max_items:
                break
        if kept == 0:
            section_lines.append(f"- {fallback}")
        return "\n".join(section_lines)

    def _render_core_profile(self) -> str:
        persona = self.config_store.config.persona
        header_lines = [
            f"更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "格式版本: core_profile.v2",
        ]
        about_her = [
            f"伴侣名字: {persona.partner_name}",
            f"伴侣身份: {persona.partner_role}",
            f"核心气质: {persona.core_identity}",
        ]
        relationship_core = [
            f"对用户称呼: {persona.call_user}",
            f"互动边界: {persona.boundaries}",
        ]
        important_categories = {"preference", "promise", "anniversary"}
        important_memories = [
            item
            for item in self.list_memories_grouped().get("items", [])
            if item.get("category") in important_categories
        ]
        my_profile = [
            f"[{item.get('category', 'other')}] {item.get('title', '')}: {item.get('content', '')}"
            for item in important_memories
        ]
        section_category_map = {
            "About Her": "core_profile_about_her",
            "Relationship Core": "core_profile_relationship_core",
            "My Profile": "core_profile_my_profile",
        }
        approved_core_snippets = self.memory_store.list_memories(limit=50, memory_kind="long_term")
        def _collect_section_entries(category: str, limit: int) -> list[str]:
            entries: list[str] = []
            for record in approved_core_snippets:
                if record.category != category:
                    continue
                for line in str(record.content or "").splitlines():
                    normalized = self._normalize_merge_entry(line)
                    if not normalized:
                        continue
                    if normalized.casefold() in {item.casefold() for item in entries}:
                        continue
                    entries.append(normalized)
                    if len(entries) >= limit:
                        return entries
            return entries

        about_her.extend(_collect_section_entries(section_category_map["About Her"], limit=3))
        relationship_core.extend(_collect_section_entries(section_category_map["Relationship Core"], limit=4))
        my_profile.extend(_collect_section_entries(section_category_map["My Profile"], limit=4))
        sections = [
            self._render_memory_section(
                "About Her",
                about_her,
                max_items=4,
                max_chars_per_item=160,
                fallback="暂无可用信息。",
            ),
            self._render_memory_section(
                "Relationship Core",
                relationship_core,
                max_items=4,
                max_chars_per_item=180,
                fallback="暂无可用信息。",
            ),
            self._render_memory_section(
                "My Profile",
                my_profile,
                max_items=8,
                max_chars_per_item=180,
                fallback="暂无关键长期记忆。",
            ),
        ]
        return "\n\n".join(header_lines + sections).strip() + "\n"

    def _render_recent_daily_logs_context(self) -> str:
        target_days = [
            datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1),
            datetime.now().replace(hour=0, minute=0, second=0, microsecond=0),
        ]
        labels = ["昨天日志", "今天日志"]
        lines: list[str] = []
        records = self.memory_store.list_memories(limit=8, memory_kind="daily_log")
        for label, day in zip(labels, target_days):
            day_key = day.strftime("%Y-%m-%d")
            matched = None
            for record in records:
                content = str(record.content or "")
                if day_key in content or day.strftime("%Y%m%d") in str(record.id or "") or day.strftime("%Y-%m-%d") in str(record.key or ""):
                    matched = record
                    break
            if matched is None:
                continue
            snippet = str(matched.content or "").strip()
            if not snippet:
                continue
            snippet = snippet[:1200]
            lines.append(f"{label}：\n{snippet}")
        return "\n\n".join(lines).strip()

    def _render_active_memory(self) -> str:
        header_lines = [
            f"更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "格式版本: active_memory.v2",
        ]
        preferred_categories = {"preference", "promise", "anniversary", "identity", "relationship"}
        recent_memories = self.memory_store.list_memories(
            limit=20, memory_kind="long_term"
        )
        selected_memories = [
            record
            for record in recent_memories
            if record.category != "memory_refresh"
            and record.category in preferred_categories
        ]
        current_status = [
            f"高价值记忆数量: {len(selected_memories)}",
            "若近期上下文不足，请优先参考 core_profile.md。",
        ]
        purpose_context = [
            f"[{record.category}] {record.key}: {record.content}"
            for record in selected_memories
        ]
        on_the_horizon = [
            f"待跟进线索: {record.key}"
            for record in selected_memories
            if record.category in {"promise", "anniversary", "relationship"}
        ]
        others = [
            "本文件用于短期活跃记忆，不替代 SQLite 长期记忆检索。",
            "渲染时已做条目数与单条长度限制，避免提示词膨胀。",
        ]
        sections = [
            self._render_memory_section(
                "Current Status",
                current_status,
                max_items=4,
                max_chars_per_item=160,
                fallback="暂无状态信息。",
            ),
            self._render_memory_section(
                "Purpose Context",
                purpose_context,
                max_items=6,
                max_chars_per_item=180,
                fallback="暂无新增，主要依赖核心档案。",
            ),
            self._render_memory_section(
                "On the Horizon",
                on_the_horizon,
                max_items=4,
                max_chars_per_item=160,
                fallback="暂无明确待跟进事项。",
            ),
            self._render_memory_section(
                "Others",
                others,
                max_items=4,
                max_chars_per_item=160,
                fallback="暂无。",
            ),
        ]
        return "\n\n".join(header_lines + sections).strip() + "\n"

    def _dedupe_tool_contexts(
        self, tool_contexts: list[Dict[str, Any]], active_memory: str = ""
    ) -> list[Dict[str, Any]]:
        deduped: list[Dict[str, Any]] = []
        seen_pairs: set[tuple[str, str]] = set()
        normalized_active = " ".join((active_memory or "").split())
        for item in tool_contexts:
            item_type = str(item.get("type", "") or "")
            context = str(item.get("context", "") or "").strip()
            if item_type == "memory_search":
                kept_lines: list[str] = []
                for raw_line in context.splitlines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    normalized_line = " ".join(line.split())
                    if normalized_line and normalized_line in normalized_active:
                        continue
                    kept_lines.append(line)
                context = "\n".join(dict.fromkeys(kept_lines)).strip()
                if not context:
                    continue
                item = dict(item)
                item["context"] = context
            fingerprint = (item_type, " ".join(context.split()))
            if fingerprint in seen_pairs:
                continue
            seen_pairs.add(fingerprint)
            deduped.append(item)
        return deduped

    def _refresh_active_memory(self) -> None:
        self._write_text_file(self._active_memory_file(), self._render_active_memory())

    def _local_day_bounds(self) -> tuple[datetime, datetime]:
        start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)

    def _daily_log_memory_id(self, profile_id: str, day: datetime) -> str:
        slug = re.sub(r"[^a-zA-Z0-9:_-]+", "_", profile_id).strip("_") or "local-user"
        return f"log_{slug}_{day.strftime('%Y%m%d')}"

    def _daily_log_session_ref(self, profile_id: str, day: datetime) -> str:
        return f"{profile_id}:{day.strftime('%Y-%m-%d')}"

    def _summarize_daily_log_chunk(
        self,
        *,
        profile_id: str,
        day: datetime,
        messages: list[Dict[str, Any]],
        chunk_start: int,
        chunk_end: int,
    ) -> str:
        provider = self._preferred_extraction_provider()
        if provider is None:
            return f"- 本段已覆盖第 {chunk_start}-{chunk_end} 条消息，但当前未配置可用提炼模型，暂未生成摘要。"
        transcript_lines: list[str] = []
        for item in messages:
            role = "用户" if item.get("role") == "user" else "Aelios"
            timestamp = str(item.get("created_at", "") or "")
            try:
                time_label = datetime.fromisoformat(timestamp).strftime("%H:%M")
            except ValueError:
                time_label = "--:--"
            content = str(item.get("content", "") or "").strip()
            if not content:
                continue
            transcript_lines.append(f"[{time_label}] {role}：{content}")
        if not transcript_lines:
            return f"- 第 {chunk_start}-{chunk_end} 条消息没有可整理内容。"
        prompt = (
            f"你是今日日志整理助手。请把 {day.strftime('%Y-%m-%d')} 这一天里第 {chunk_start}-{chunk_end} 条聊天消息整理成“摘要”，而不是转抄原话。\n"
            "只保留以下信息：\n"
            "1. 用户今天发生了什么、在意什么\n"
            "2. 用户表达出的情绪、状态、计划、偏好变化\n"
            "3. 双方形成的新约定、提醒、需要后续跟进的点\n"
            "4. 值得进入长期记忆的候选信息线索\n\n"
            "严禁：\n"
            "- 逐句转写对话\n"
            "- 使用‘用户说/AI说’流水账\n"
            "- 记录寒暄和废话\n\n"
            "输出格式：\n"
            "- 用 4~8 条中文要点总结\n"
            "- 每条尽量一句话\n"
            "- 直接输出摘要内容，不要加解释\n\n"
            "聊天内容：\n" + "\n".join(transcript_lines[:80])
        )
        try:
            result = request_chat_completion(
                provider,
                [
                    {
                        "role": "system",
                        "content": "你是摘要整理助手，只输出简明中文要点。",
                    },
                    {"role": "user", "content": prompt},
                ],
                stream=False,
                temperature=0.2,
                timeout=30,
            )
            summary = extract_text_content(result).strip()
        except Exception:
            summary = ""
        if self._looks_like_transcript(summary):
            summary = ""
        if not summary:
            return f"- 第 {chunk_start}-{chunk_end} 条消息未成功生成摘要。"
        return summary

    def _looks_like_transcript(self, text: str) -> bool:
        normalized = text.strip()
        if not normalized:
            return False
        transcript_markers = [
            r"\[\d{2}:\d{2}\]",
            r"用户：",
            r"Aelios：",
            r"AI：",
            r"^-",
        ]
        hits = sum(
            1
            for pattern in transcript_markers
            if re.search(pattern, normalized, flags=re.M)
        )
        return hits >= 2 and len(normalized.splitlines()) >= 4

    def _extract_daily_log_processed_count(self, content: str) -> int:
        text = str(content or "")
        patterns = [
            r"已整理消息：\s*(\d+)",
            r"已整理\s*(\d+)\s*条消息",
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return max(0, int(match.group(1)))
        ends = [int(end) for _, end in re.findall(r"### 第 \d+ 段（\d+-(\d+)）", text)]
        return max(ends) if ends else 0

    def _extract_daily_log_sections(self, content: str) -> list[tuple[str, str]]:
        text = str(content or "")
        marker = "今日日志摘要："
        if marker in text:
            text = text.split(marker, 1)[1].strip()
        if not text:
            return []
        sections: list[tuple[str, str]] = []
        current_header = ""
        buffer: list[str] = []

        def flush() -> None:
            nonlocal current_header, buffer
            if current_header:
                body = "\n".join(buffer).strip()
                sections.append((current_header, body))
            current_header = ""
            buffer = []

        for line in text.splitlines():
            if line.startswith("### "):
                flush()
                current_header = line.strip()
                buffer = []
            elif current_header:
                buffer.append(line)
        flush()
        return sections

    def _merge_daily_log_sections(
        self, existing_content: str, header: str, summary: str
    ) -> list[str]:
        merged: list[tuple[str, str]] = []
        seen_headers: set[str] = set()
        for existing_header, body in self._extract_daily_log_sections(existing_content):
            if existing_header == header:
                continue
            if existing_header in seen_headers:
                continue
            seen_headers.add(existing_header)
            merged.append((existing_header, body))
        merged.append((header, summary.strip()))
        return [f"{h}\n{b}".strip() for h, b in merged if h and b.strip()]

    def _compose_daily_log_content(
        self,
        *,
        profile_id: str,
        day: datetime,
        processed_count: int,
        sections: list[str],
    ) -> tuple[str, str]:
        title = f"{day.strftime('%Y-%m-%d')} 今日日志摘要"
        header = [
            f"日期：{day.strftime('%Y-%m-%d')}",
            f"已整理消息：{processed_count}",
            f"用户：{profile_id}",
            "",
            "今日日志摘要：",
        ]
        return title, "\n".join(header + sections).strip()

    def _update_daily_log(self, *, profile_id: str, session_id: str) -> None:
        day_start, day_end = self._local_day_bounds()
        start_iso = day_start.isoformat()
        end_iso = day_end.isoformat()
        all_messages = self.runtime_store.list_messages_between(
            profile_id=profile_id,
            start_at=start_iso,
            end_at=end_iso,
            limit=2000,
        )
        user_messages = [item for item in all_messages if item.get("role") == "user"]
        total_messages = len(user_messages)
        threshold = total_messages // 20
        if threshold <= 0:
            return
        log_id = self._daily_log_memory_id(profile_id, day_start)
        existing = self.memory_store.get_memory(log_id)
        previous_threshold = 0
        if existing is not None:
            previous_threshold = max(0, self._extract_daily_log_processed_count(existing.content) // 20)
        if threshold <= previous_threshold:
            return
        if not all_messages:
            return
        capped_count = threshold * 20
        chunk_start = previous_threshold * 20 + 1
        target_user_ids = {
            item.get("id")
            for item in user_messages[previous_threshold * 20 : capped_count]
        }
        selected = [
            item
            for item in all_messages
            if item.get("role") != "user"
            or item.get("id") in target_user_ids
            or len(target_user_ids) > 0
        ]
        if target_user_ids:
            valid_target_ids = [int(i) for i in target_user_ids if i is not None]
            if not valid_target_ids:
                return
            last_target_id = max(valid_target_ids)
            selected = [
                item
                for item in all_messages
                if int(item.get("id", 0) or 0) <= last_target_id
            ]
            prev_target_id = 0
            if previous_threshold > 0:
                previous_ids = [
                    item.get("id")
                    for item in user_messages[: previous_threshold * 20]
                    if item.get("id") is not None
                ]
                valid_previous_ids = [int(i) for i in previous_ids if i is not None]
                prev_target_id = max(valid_previous_ids) if valid_previous_ids else 0
            selected = [
                item
                for item in selected
                if int(item.get("id", 0) or 0) > prev_target_id
            ]
        if not selected:
            return
        summary = self._summarize_daily_log_chunk(
            profile_id=profile_id,
            day=day_start,
            messages=selected,
            chunk_start=chunk_start,
            chunk_end=capped_count,
        )
        existing_content = existing.content if existing is not None else ""
        section_header = f"### 第 {threshold} 段（{chunk_start}-{capped_count}）"
        sections = self._merge_daily_log_sections(existing_content, section_header, summary)
        title, content = self._compose_daily_log_content(
            profile_id=profile_id,
            day=day_start,
            processed_count=capped_count,
            sections=sections,
        )
        self.memory_store.upsert_memory(
            memory_id=log_id,
            key=title,
            content=content,
            memory_kind="daily_log",
            category="daily_log",
            importance=0.2,
            session_id=self._daily_log_session_ref(profile_id, day_start),
        )
        self._refresh_active_memory()

    def _should_trigger_goodnight_refresh(self, user_text: str) -> bool:
        normalized = str(user_text or "").strip().lower()
        if not normalized:
            return False
        return any(phrase in normalized for phrase in self._goodnight_phrases)

    def _extract_memories_from_chat(
        self,
        messages: list[Dict[str, Any]],
        response_content: str,
        profile_id: str = "",
        session_id: str = "",
    ) -> None:
        user_text = ""
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    user_text += content + "\n"
        user_text = user_text.strip()
        if not user_text:
            return
        profile = profile_id or "local-user"
        self._update_daily_log(profile_id=profile, session_id=session_id)
        if self._should_trigger_goodnight_refresh(user_text):
            self._force_daily_log(profile_id=profile, session_id=session_id)
            self._run_memory_digest(profile_id=profile, session_id=session_id)

    def _force_daily_log(self, *, profile_id: str, session_id: str) -> None:
        day_start, day_end = self._local_day_bounds()
        start_iso = day_start.isoformat()
        end_iso = day_end.isoformat()
        all_messages = self.runtime_store.list_messages_between(
            profile_id=profile_id,
            start_at=start_iso,
            end_at=end_iso,
            limit=2000,
        )
        if not all_messages:
            return
        user_messages = [item for item in all_messages if item.get("role") == "user"]
        if not user_messages:
            return
        log_id = self._daily_log_memory_id(profile_id, day_start)
        existing = self.memory_store.get_memory(log_id)
        if existing is None:
            self._update_daily_log(profile_id=profile_id, session_id=session_id)
            return

        processed_count = self._extract_daily_log_processed_count(existing.content or "")
        if len(user_messages) <= processed_count:
            return

        remaining_user_messages = user_messages[processed_count:]
        remaining_ids = [int(item.get("id", 0) or 0) for item in remaining_user_messages]
        if not remaining_ids:
            return
        first_target_id = min(remaining_ids)
        last_target_id = max(remaining_ids)
        selected = [
            item
            for item in all_messages
            if first_target_id <= int(item.get("id", 0) or 0) <= last_target_id
        ]
        if not selected:
            return

        summary = self._summarize_daily_log_chunk(
            profile_id=profile_id,
            day=day_start,
            messages=selected,
            chunk_start=processed_count + 1,
            chunk_end=len(user_messages),
        )
        existing_content = existing.content or ""
        section_header = f"### 晚安前补全摘要（{processed_count + 1}-{len(user_messages)}）"
        sections = self._merge_daily_log_sections(existing_content, section_header, summary)
        title, content = self._compose_daily_log_content(
            profile_id=profile_id,
            day=day_start,
            processed_count=len(user_messages),
            sections=sections,
        )
        self.memory_store.upsert_memory(
            memory_id=log_id,
            key=title,
            content=content,
            memory_kind="daily_log",
            category="daily_log",
            importance=0.2,
            session_id=self._daily_log_session_ref(profile_id, day_start),
        )
        self._refresh_active_memory()

    def dedupe_daily_log(self, *, profile_id: str = "", day: Optional[datetime] = None) -> Dict[str, Any]:
        target_day = day or self._local_day_bounds()[0]
        target_profile = profile_id or "local-user"
        log_id = self._daily_log_memory_id(target_profile, target_day)
        record = self.memory_store.get_memory(log_id)
        if record is None:
            return {"ok": False, "reason": "daily log not found", "memory_id": log_id}
        content = record.content or ""
        title, body = (content.split("今日日志摘要：", 1) + [""])[:2]
        prefix = (title + "今日日志摘要：").strip() if "今日日志摘要：" in content else ""
        merged: dict[str, str] = {}
        order: list[str] = []
        for header, section_body in self._extract_daily_log_sections(content):
            if header not in merged:
                order.append(header)
            merged[header] = section_body.strip()
        section_lines = [f"{header}\n{merged[header]}".strip() for header in order if merged.get(header)]
        new_content = (prefix + "\n" + "\n".join(section_lines)).strip() if prefix else "\n".join(section_lines).strip()
        changed = new_content != content.strip()
        if changed:
            processed_count = self._extract_daily_log_processed_count(new_content)
            title_text, rebuilt = self._compose_daily_log_content(
                profile_id=target_profile,
                day=target_day,
                processed_count=processed_count,
                sections=section_lines,
            )
            self.memory_store.upsert_memory(
                memory_id=record.id,
                key=title_text,
                content=rebuilt,
                memory_kind=record.memory_kind,
                category=record.category,
                importance=record.importance,
                session_id=record.session_id,
            )
            self._refresh_active_memory()
        return {"ok": True, "changed": changed, "memory_id": record.id}

    def _build_nightly_digest_payload(self, end_at: datetime) -> Dict[str, Any]:
        window_end_utc = end_at.astimezone(ZoneInfo("UTC")) if end_at.tzinfo else end_at
        window_start_utc = window_end_utc - timedelta(hours=24)
        messages = self.runtime_store.list_messages_between(
            start_at=window_start_utc.isoformat(),
            end_at=window_end_utc.isoformat(),
            limit=800,
        )
        events = [
            item
            for item in self.runtime_store.list_events(limit=240)
            if item.get("event_type") == "tool_execute"
            and str(item.get("created_at", "")) >= window_start_utc.isoformat()
        ][:40]
        active_memory = self._read_text_file(self._active_memory_file())
        durable_memories = self.memory_store.list_memories(limit=12, memory_kind="long_term")
        durable_lines = [
            f"- [{record.category}] {record.key}: {record.content[:160]}"
            for record in durable_memories
            if record.category != "memory_refresh"
        ]
        return {
            "window_start": window_start_utc.isoformat(),
            "window_end": window_end_utc.isoformat(),
            "messages": messages,
            "events": events,
            "active_memory": active_memory,
            "durable_memory_lines": durable_lines,
        }

    def _render_nightly_digest_markdown(
        self,
        *,
        local_date: str,
        payload: Dict[str, Any],
        summary: str,
    ) -> str:
        message_lines = []
        for item in payload.get("messages", [])[:80]:
            role = "用户" if item.get("role") == "user" else "Aelios"
            content = self._sanitize_memory_line(str(item.get("content", "")), 180)
            if content:
                message_lines.append(f"- {role}: {content}")
        event_lines = []
        for event in payload.get("events", [])[:20]:
            payload_obj = event.get("payload") or {}
            tool_name = str(payload_obj.get("tool", "") or "")
            if tool_name:
                event_lines.append(f"- tool_execute: {tool_name}")
        lines = [
            f"# {local_date} daily digest",
            "",
            f"生成时间: {self._now_in_local_timezone().isoformat(timespec='seconds')}",
            f"回顾窗口(UTC): {payload.get('window_start', '')} -> {payload.get('window_end', '')}",
            "",
            "## Summary",
            summary or "- 无可提炼摘要。",
            "",
            "## Recent Messages (24h)",
            "\n".join(message_lines) if message_lines else "- 无消息。",
            "",
            "## Relevant Tool Outputs",
            "\n".join(event_lines) if event_lines else "- 无工具输出。",
            "",
            "## Active Memory Snapshot",
            payload.get("active_memory", "")[:2000] or "- active_memory 为空。",
            "",
            "## Durable Memory Candidates",
            "\n".join(payload.get("durable_memory_lines", [])[:12]) or "- 无。",
            "",
            "TODO: pending_core_updates proposal workflow not included in slice 2.",
            "TODO: durable-memory archival refinement can be added in a later slice.",
        ]
        return "\n".join(lines).strip() + "\n"

    def _generate_nightly_digest_summary(self, payload: Dict[str, Any]) -> str:
        provider = self._preferred_extraction_provider()
        if provider is None:
            return "- 未配置可用提炼模型，跳过自动摘要。"
        transcript = []
        for item in payload.get("messages", [])[:80]:
            role = "用户" if item.get("role") == "user" else "Aelios"
            content = self._sanitize_memory_line(str(item.get("content", "")), 180)
            if content:
                transcript.append(f"{role}: {content}")
        event_lines = []
        for event in payload.get("events", [])[:20]:
            payload_obj = event.get("payload") or {}
            tool_name = str(payload_obj.get("tool", "") or "")
            if tool_name:
                event_lines.append(f"- {tool_name}")
        prompt = (
            "你是夜间记忆整理助手。请根据最近 24 小时消息和工具输出，生成 6~10 条中文要点，供次日对话衔接使用。\n"
            "要求：\n"
            "1) 输出简洁要点，不要逐句转写。\n"
            "2) 重点关注状态变化、计划、承诺、待跟进事项。\n"
            "3) 不要改写核心档案。\n\n"
            "消息：\n"
            + "\n".join(transcript or ["- 无"])
            + "\n\n工具输出：\n"
            + "\n".join(event_lines or ["- 无"])
            + "\n\n当前 active_memory：\n"
            + str(payload.get("active_memory", ""))[:2500]
        )
        try:
            result = request_chat_completion(
                provider,
                [
                    {"role": "system", "content": "你是摘要整理助手，只输出中文要点。"},
                    {"role": "user", "content": prompt},
                ],
                stream=False,
                temperature=0.2,
                timeout=30,
            )
            summary = extract_text_content(result).strip()
        except Exception:
            summary = ""
        if not summary:
            return "- 自动摘要失败，已保留原始输入快照。"
        return summary

    def _upsert_trilium_daily_digest(self, *, local_date: str, content: str) -> Dict[str, Any]:
        title = f"{local_date} daily digest"
        path_titles = ["AI Companion Workspace", "Daily Digest"]
        if not self.trilium_client.enabled:
            return {
                "ok": False,
                "status": "trilium_unavailable",
                "note_id": "",
                "reason": "trilium disabled or misconfigured",
            }
        return self.trilium_client.upsert_note_by_path(
            path_titles=path_titles,
            note_title=title,
            content=content,
        )

    def _run_scheduled_nightly_digest(self) -> bool:
        now_local = self._now_in_local_timezone()
        local_date = now_local.strftime("%Y-%m-%d")
        state = self._read_digest_run_state()
        if state.get("id") == local_date and state.get("status") == "success":
            self.record_event(
                "digest_run",
                {"status": "skipped", "reason": "already_success", "date": local_date},
            )
            return True
        started_at = datetime.utcnow().isoformat()
        self._write_digest_run_state(
            {
                "id": local_date,
                "run_state": "nightly_digest",
                "status": "running",
                "started_at": started_at,
                "completed_at": "",
                "error_message": "",
            }
        )
        try:
            payload = self._build_nightly_digest_payload(now_local)
            summary = self._generate_nightly_digest_summary(payload)
            digest_content = self._render_nightly_digest_markdown(
                local_date=local_date,
                payload=payload,
                summary=summary,
            )
            self._refresh_active_memory()
            trilium_result = self._upsert_trilium_daily_digest(
                local_date=local_date,
                content=digest_content,
            )
            completed_at = datetime.utcnow().isoformat()
            if not trilium_result.get("ok"):
                self._write_digest_run_state(
                    {
                        "id": local_date,
                        "run_state": "nightly_digest",
                        "status": "failed",
                        "started_at": started_at,
                        "completed_at": completed_at,
                        "error_message": str(
                            trilium_result.get("reason", "trilium unavailable")
                        ),
                    }
                )
                self.record_event(
                    "digest_run",
                    {
                        "status": "failed",
                        "reason": "trilium_unavailable",
                        "date": local_date,
                    },
                )
                return False
            self._write_digest_run_state(
                {
                    "id": local_date,
                    "run_state": "nightly_digest",
                    "status": "success",
                    "started_at": started_at,
                    "completed_at": completed_at,
                    "error_message": "",
                }
            )
            self.record_event(
                "digest_run",
                {
                    "status": "success",
                    "date": local_date,
                    "note_id": trilium_result.get("note_id", ""),
                },
            )
            return True
        except Exception as error:
            self._write_digest_run_state(
                {
                    "id": local_date,
                    "run_state": "nightly_digest",
                    "status": "failed",
                    "started_at": started_at,
                    "completed_at": datetime.utcnow().isoformat(),
                    "error_message": str(error),
                }
            )
            self.record_event(
                "digest_run",
                {
                    "status": "failed",
                    "reason": "exception",
                    "date": local_date,
                    "error": str(error),
                },
            )
            return False

    def _run_memory_digest(self, profile_id: str = "", session_id: str = "") -> None:
        provider = self._preferred_extraction_provider()
        if provider is None:
            return
        day_start, day_end = self._local_day_bounds()
        log_id = self._daily_log_memory_id(profile_id or "local-user", day_start)
        daily_log = self.memory_store.get_memory(log_id)
        if daily_log is None:
            return
        existing_refresh_key = (
            f"digest::{(profile_id or 'local-user')}::{day_start.strftime('%Y-%m-%d')}"
        )
        existing_refresh = self.memory_store.search(
            existing_refresh_key,
            limit=1,
            memory_kind="long_term",
        )
        if existing_refresh:
            return

        existing_memories = self.memory_store.list_memories(
            limit=80, memory_kind="long_term"
        )
        existing_blocks = [
            f"- [{item.category}] {item.key}: {item.content[:200]}"
            for item in existing_memories
            if item.category != "memory_refresh"
        ]

        digest_prompt = (
            "你是长期记忆整理助手。现在只能基于‘今日日志摘要’来更新长期记忆。\n"
            "请把已有长期记忆视为可修改的事实表，不要逐条照抄摘要，不要生成日志型条目。\n"
            "只有以下类型允许进入长期记忆：世界书设定、稳定喜好、重要关系事实、长期边界、约定/承诺、纪念日、持续习惯、重要阶段事件。\n"
            "如果日志里没有值得长期保留的信息，就返回空数组。\n\n"
            "现有长期记忆：\n"
            + ("\n".join(existing_blocks[:40]) if existing_blocks else "- 暂无")
            + "\n\n今日日志摘要：\n"
            + daily_log.content[:5000]
            + "\n\n"
            "输出 JSON 数组。每一项格式如下：\n"
            '[{"id": "existing_or_empty", "key": "简短标题", "content": "更新后的完整内容", "category": "preference|promise|event|anniversary|emotion|habit|boundary|other", "importance": 0.5}]\n\n'
            "规则：\n"
            "1. 如果是更新已有长期记忆，必须填已有记忆 id。\n"
            "2. 如果是新增长期记忆，id 留空字符串。\n"
            "3. 不要输出 daily_log / log / summary 类型。\n"
            "4. 只输出 JSON，不要输出其他解释。"
        )
        try:
            result = request_chat_completion(
                provider,
                [
                    {"role": "system", "content": "你是记忆整理助手，只输出 JSON。"},
                    {"role": "user", "content": digest_prompt},
                ],
                stream=False,
                temperature=0.1,
                timeout=30,
            )
            raw = extract_text_content(result).strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
            items = json.loads(raw)
            if not isinstance(items, list):
                return
            updated_any = False
            existing_by_id = {item.id: item for item in existing_memories}
            for item in items[:10]:
                if not isinstance(item, dict):
                    continue
                target_id = str(item.get("id", "") or "").strip()
                key = str(item.get("key", "")).strip()
                content = str(item.get("content", "")).strip()
                if not key or not content:
                    continue
                category = str(item.get("category", "other")).strip() or "other"
                importance = float(item.get("importance", 0.5) or 0.5)
                importance = max(0.0, min(1.0, importance))
                if category == "daily_log":
                    continue
                target_section = self._categorize_core_update_target(item)
                if target_section:
                    proposal_type, confidence = self._classify_proposal_metadata(item)
                    self._create_core_update_proposal(
                        target_section=target_section,
                        proposed_content=content,
                        reason="nightly_digest_candidate",
                        source_context=json.dumps(item, ensure_ascii=False),
                        proposal_type=proposal_type,
                        confidence=confidence,
                    )
                    continue
                memory_id = (
                    target_id
                    or f"digest_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
                )
                if target_id and target_id not in existing_by_id:
                    continue
                self.memory_store.upsert_memory(
                    memory_id=memory_id,
                    key=key,
                    content=content,
                    memory_kind="long_term",
                    category=category,
                    importance=importance,
                    session_id=session_id,
                )
                updated_any = True
        except Exception:
            pass
        else:
            if updated_any:
                self.memory_store.upsert_memory(
                    memory_id=f"refresh_{day_start.strftime('%Y%m%d')}_{profile_id or 'local-user'}",
                    key=existing_refresh_key,
                    content=f"已在 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} 根据今日日志刷新长期记忆。",
                    memory_kind="long_term",
                    category="memory_refresh",
                    importance=0.0,
                    session_id=self._daily_log_session_ref(
                        profile_id or "local-user", day_start
                    ),
                )
        self._refresh_active_memory()

    def _read_text_file(self, file_path: Path) -> str:
        if not file_path.exists():
            return ""
        return file_path.read_text(encoding="utf-8").strip()

    def _write_text_file(self, file_path: Path, content: str) -> None:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")

    def _summarize_event(self, event: Dict[str, Any]) -> str:
        event_type = event.get("event_type", "event")
        payload = event.get("payload") or {}
        response = str(payload.get("response", "") or "").strip()
        prompt = ""
        messages = payload.get("messages") or []
        if messages:
            prompt = str(messages[-1].get("content", "") or "").strip()
        if event_type == "tool_execute":
            return f"工具调用: {payload.get('tool', '')}"
        if prompt and response:
            return f"{event_type}: 用户说“{prompt[:60]}”，系统回复“{response[:80]}”"
        if prompt:
            return f"{event_type}: 用户说“{prompt[:80]}”"
        if response:
            return f"{event_type}: 系统回复“{response[:100]}”"
        return f"{event_type}: {json.dumps(payload, ensure_ascii=False)[:120]}"


class RequestHandler(BaseHTTPRequestHandler):
    app: Optional[GatewayApp] = None
    protocol_version = "HTTP/1.1"

    def _app(self) -> GatewayApp:
        if self.app is None:
            raise RuntimeError("gateway app is not bound")
        return self.app

    def _auth_required(self) -> bool:
        return bool(self._app().config_store.config.dashboard_security.enabled)

    def _check_auth(self) -> bool:
        if not self._auth_required():
            return True
        expected_password = str(
            self._app().config_store.config.dashboard_security.password or ""
        )
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Basic "):
            return False
        token = auth[6:].strip()
        try:
            decoded = base64.b64decode(token).decode("utf-8")
        except Exception:
            return False
        _, _, password = decoded.partition(":")
        if expected_password.startswith("sha256:"):
            return normalize_dashboard_password(password) == expected_password
        return password == expected_password

    def _require_auth(self) -> bool:
        if self._check_auth():
            return True
        payload = json.dumps(
            {"error": "authentication required"}, ensure_ascii=False
        ).encode("utf-8")
        self.send_response(HTTPStatus.UNAUTHORIZED)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("WWW-Authenticate", 'Basic realm="Saki Dashboard"')
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)
        return False

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Saki-Provider",
        )
        self.send_header(
            "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"
        )
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            app = self._app()
            if parsed.path == "/health":
                self._json(HTTPStatus.OK, {"ok": True, "state": app.state()})
                return
            if parsed.path == "/api/config":
                self._json(HTTPStatus.OK, app.public_config_payload())
                return
            if parsed.path == "/api/providers/status":
                self._json(HTTPStatus.OK, app.provider_status_payload())
                return
            if parsed.path == "/api/channels/qq/status":
                self._json(
                    HTTPStatus.OK,
                    {
                        "qqbot": app.qqbot_channel.status()
                        if app.qqbot_channel
                        else {"enabled": False, "ready": False},
                        "qq": app.napcat_channel.status()
                        if app.napcat_channel
                        else {"enabled": False, "ready": False},
                    },
                )
                return
            if parsed.path == "/api/tools":
                self._json(HTTPStatus.OK, {"tools": app.tools.list_enabled()})
                return
            if parsed.path == "/api/memories/stats":
                grouped = app.list_memories_grouped()
                self._json(HTTPStatus.OK, {"stats": grouped.get("stats", {})})
                return
            if parsed.path == "/api/memories":
                category = parse_qs(parsed.query).get("category", [""])[0]
                self._json(HTTPStatus.OK, app.list_memories_grouped(category))
                return
            if parsed.path == "/api/logs":
                query = parse_qs(parsed.query)
                profile_id = query.get("profile_id", [""])[0]
                session_id = query.get("session_id", [""])[0]
                limit = int(query.get("limit", ["60"])[0] or "60")
                self._json(
                    HTTPStatus.OK,
                    app.list_daily_logs_payload(profile_id, session_id, limit),
                )
                return
            if parsed.path == "/api/sessions":
                profile_id = parse_qs(parsed.query).get("profile_id", [""])[0]
                self._json(HTTPStatus.OK, app.list_sessions_payload(profile_id))
                return
            if parsed.path == "/api/events":
                query = parse_qs(parsed.query)
                profile_id = query.get("profile_id", [""])[0]
                session_id = query.get("session_id", [""])[0]
                limit = int(query.get("limit", ["50"])[0] or "50")
                self._json(
                    HTTPStatus.OK,
                    app.list_events_payload(profile_id, session_id, limit),
                )
                return
            if parsed.path == "/api/reminders":
                query = parse_qs(parsed.query)
                profile_id = query.get("profile_id", [""])[0]
                status = query.get("status", [""])[0]
                self._json(
                    HTTPStatus.OK, app.list_reminders_payload(profile_id, status)
                )
                return
            if parsed.path == "/api/memories/search":
                query = parse_qs(parsed.query).get("q", [""])[0]
                self._json(HTTPStatus.OK, app.search_memories_payload(query))
                return
            if parsed.path == "/api/context":
                self._json(HTTPStatus.OK, app.get_context_payload())
                return
            if parsed.path == "/api/data/export":
                self._json(HTTPStatus.OK, app.export_backup_payload())
                return
            static_path = app.resolve_static_path(parsed.path)
            if static_path is not None:
                self._serve_static(static_path)
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Exception as error:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

    def do_POST(self) -> None:
        try:
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            app = self._app()
            body = self._read_json()
            if parsed.path == "/api/config":
                self._json(HTTPStatus.OK, app.update_config(body))
                return
            if parsed.path == "/api/channels/qq/inbound":
                if body.get("op") == 13:
                    if app.qqbot_channel is None:
                        raise ValueError("qqbot channel is not enabled")
                    self._json(
                        HTTPStatus.OK, app.qqbot_channel.validation_response(body)
                    )
                    return
                if app.qqbot_channel is not None and body.get("t"):
                    app.qqbot_channel.handle_event(body)
                    self._json(HTTPStatus.OK, {"ok": True, "provider": "qqbot"})
                    return
                if app.napcat_channel is None:
                    raise ValueError("qq channel is not enabled")
                app.napcat_channel.handle_event(body)
                self._json(HTTPStatus.OK, {"ok": True})
                return
            if parsed.path == "/api/memories":
                self._json(HTTPStatus.CREATED, app.upsert_panel_memory(body))
                return
            if parsed.path == "/api/reminders":
                self._json(HTTPStatus.CREATED, app.create_reminder_payload(body))
                return
            if parsed.path == "/api/data/import":
                self._json(HTTPStatus.OK, app.import_backup_payload(body))
                return
            if parsed.path == "/api/tools/execute":
                tool_id = str(body.get("tool", ""))
                payload = body.get("input") or {}
                try:
                    result = app.tools.execute(tool_id, payload)
                except Exception as error:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                    return
                app._record_event(
                    "tool_execute",
                    {"tool": tool_id, "input": payload, "result": result},
                    profile_id=str(payload.get("profile_id", "") or ""),
                )
                self._json(HTTPStatus.OK, {"result": result})
                return
            if parsed.path == "/api/chat/complete":
                self._json(HTTPStatus.OK, app.chat_complete(body))
                return
            if parsed.path == "/api/chat/respond":
                self._json(HTTPStatus.OK, app.chat_respond(body))
                return
            if parsed.path == "/api/v1/chat/completions":
                provider_name = self.headers.get("X-Saki-Provider", "chat")
                self._json(
                    HTTPStatus.OK, app.openai_compatible_chat(body, provider_name)
                )
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Exception as error:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

    def do_HEAD(self) -> None:
        try:
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            static_path = self._app().resolve_static_path(parsed.path)
            if static_path is None:
                self.send_response(HTTPStatus.NOT_FOUND)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            data_length = static_path.stat().st_size
            mime_type, _ = mimetypes.guess_type(str(static_path))
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime_type or "application/octet-stream")
            self.send_header("Content-Length", str(data_length))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        except Exception:
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_PUT(self) -> None:
        try:
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            app = self._app()
            body = self._read_json()
            if parsed.path.startswith("/api/memories/"):
                memory_id = parsed.path.rsplit("/", 1)[-1]
                self._json(HTTPStatus.OK, app.upsert_panel_memory(body, memory_id))
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Exception as error:
            if isinstance(error, KeyError):
                self._json(HTTPStatus.NOT_FOUND, {"error": str(error)})
                return
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

    def do_DELETE(self) -> None:
        try:
            if not self._require_auth():
                return
            parsed = urlparse(self.path)
            app = self._app()
            if parsed.path == "/api/memories":
                self._json(HTTPStatus.OK, app.clear_panel_memories())
                return
            if parsed.path.startswith("/api/memories/"):
                memory_id = parsed.path.rsplit("/", 1)[-1]
                self._json(HTTPStatus.OK, app.delete_panel_memory(memory_id))
                return
            if parsed.path.startswith("/api/reminders/"):
                reminder_id = parsed.path.rsplit("/", 1)[-1]
                self._json(HTTPStatus.OK, app.delete_reminder_payload(reminder_id))
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        except Exception as error:
            if isinstance(error, KeyError):
                self._json(HTTPStatus.NOT_FOUND, {"error": str(error)})
                return
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("[gateway] " + format % args + "\n")

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def _json(self, status: HTTPStatus, payload: Dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False, default=_json_default).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, file_path: Path) -> None:
        data = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(str(file_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(data)


def _json_default(value: Any) -> Any:
    if hasattr(value, "__dict__"):
        return value.__dict__
    raise TypeError(f"Object of type {type(value)!r} is not JSON serializable")


def create_server(app: GatewayApp) -> ThreadingHTTPServer:
    class BoundHandler(RequestHandler):
        pass

    BoundHandler.app = app
    return ThreadingHTTPServer(
        (app.config_store.config.host, app.config_store.config.port), BoundHandler
    )


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    app = GatewayApp(root)
    server = create_server(app)
    print(
        f"saki-gateway listening on http://{server.server_address[0]}:{server.server_address[1]}"
    )
    try:
        app.start_channels()
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.shutdown()
        server.server_close()
