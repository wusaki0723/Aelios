from __future__ import annotations

import base64
import json
import mimetypes
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .config import AppConfig
from .llm import extract_text_content, request_chat_completion
from .mcp import McpBridge


ToolExecutor = Callable[[Dict[str, Any]], Dict[str, Any]]


@dataclass
class ToolSpec:
    tool_id: str
    description: str
    schema: Dict[str, Any]
    enabled: bool
    execute: ToolExecutor


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.tool_id] = spec

    def list_enabled(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": tool.tool_id,
                "description": tool.description,
                "schema": tool.schema,
            }
            for tool in self._tools.values()
            if tool.enabled
        ]

    def execute(self, tool_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        tool = self._tools.get(tool_id)
        if not tool or not tool.enabled:
            raise KeyError(f"tool '{tool_id}' is not enabled")
        return tool.execute(payload)


def _clean_html(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def _fetch_github_repo_context(url: str) -> Optional[Dict[str, Any]]:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc not in {"github.com", "www.github.com"}:
        return None
    parts = [part for part in parsed.path.strip("/").split("/") if part]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1]
    branch = "main"
    api_base = f"https://api.github.com/repos/{owner}/{repo}"
    headers = {
        "User-Agent": "saki-gateway/0.1",
        "Accept": "application/vnd.github+json",
    }

    def _get_json(target: str) -> Any:
        req = urllib.request.Request(target, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))

    try:
        repo_meta = _get_json(api_base)
    except Exception:
        return None
    default_branch = str(repo_meta.get("default_branch", "") or "").strip()
    if default_branch:
        branch = default_branch
    readme_text = ""
    try:
        readme_meta = _get_json(f"{api_base}/readme")
        download_url = str(readme_meta.get("download_url", "") or "")
        if download_url:
            req = urllib.request.Request(
                download_url, headers={"User-Agent": "saki-gateway/0.1"}
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                readme_text = response.read().decode("utf-8", errors="replace")
    except Exception:
        readme_text = ""
    file_names: list[str] = []
    try:
        tree = _get_json(f"{api_base}/contents")
        if isinstance(tree, list):
            entries = tree[:20]
            file_names = [
                str(item.get("name", "") or "")
                for item in entries
                if isinstance(item, dict)
            ]
    except Exception:
        file_names = []
    description = str(repo_meta.get("description", "") or "")
    language = str(repo_meta.get("language", "") or "")
    stars = repo_meta.get("stargazers_count", 0)
    context_parts = [
        f"GitHub 仓库：{owner}/{repo}",
        f"仓库描述：{description or '无'}",
        f"默认分支：{branch}",
        f"主要语言：{language or '未知'}",
        f"Stars：{stars}",
    ]
    if file_names:
        context_parts.append("根目录文件：" + ", ".join(file_names))
    if readme_text.strip():
        context_parts.append("README 摘录：\n" + readme_text[:4000])
    content = "\n".join(part for part in context_parts if part)
    return {"url": url, "content": content[:6000], "excerpt": content[:2000]}


def _fetch_url_content(url: str) -> Dict[str, Any]:
    github_context = _fetch_github_repo_context(url)
    if github_context is not None:
        return github_context
    req = urllib.request.Request(url, headers={"User-Agent": "saki-gateway/0.1"})
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read().decode("utf-8", errors="replace")
    cleaned = _clean_html(raw)
    return {"url": url, "content": cleaned[:6000], "excerpt": cleaned[:1500]}


def _fetch_image_as_data_url(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "saki-gateway/0.1"})
    with urllib.request.urlopen(req, timeout=20) as response:
        content_type = response.headers.get_content_type() or "application/octet-stream"
        raw = response.read()
    if content_type == "application/octet-stream":
        guessed, _ = mimetypes.guess_type(url)
        content_type = guessed or content_type
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def _local_image_as_data_url(
    image_path: str, workspace_root: Optional[Path] = None
) -> str:
    target = Path(image_path)
    if not target.is_absolute():
        base = workspace_root or Path.cwd()
        target = (base / target).resolve()
    else:
        target = target.resolve()
    if workspace_root is not None and not str(target).startswith(
        str(workspace_root.resolve())
    ):
        raise ValueError("image path escapes workspace")
    if not target.exists() or not target.is_file():
        raise ValueError("image path does not exist")
    content_type, _ = mimetypes.guess_type(str(target))
    raw = target.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{content_type or 'application/octet-stream'};base64,{encoded}"


def _image_source_as_data_url(
    image_source: str, workspace_root: Optional[Path] = None
) -> str:
    parsed = urllib.parse.urlparse(image_source)
    if parsed.scheme == "data":
        return image_source
    if parsed.scheme in {"http", "https"}:
        return _fetch_image_as_data_url(image_source)
    return _local_image_as_data_url(image_source, workspace_root)


def _allowed_workspace_root(workspace_root: Optional[Path]) -> Optional[Path]:
    if workspace_root is None:
        return None
    candidate = workspace_root.resolve()
    if candidate.name == "saki-gateway" and candidate.parent.exists():
        return candidate.parent
    return candidate


def _provider_name(provider: Any) -> str:
    return str(
        getattr(provider, "label", "")
        or getattr(provider, "backend_type", "")
        or "unknown"
    )


def _provider_ready(provider: Any) -> bool:
    return bool(
        getattr(provider, "enabled", False)
        and getattr(provider, "base_url", "")
        and getattr(provider, "api_key", "")
        and getattr(provider, "model", "")
    )


def _provider_route(config: AppConfig, purpose: str) -> List[Tuple[str, Any]]:
    if purpose == "search":
        return [
            ("search", config.search_api),
            ("tool", config.action_api),
            ("chat", config.chat_api),
        ]
    if purpose in {"tool", "image", "link"}:
        return [
            ("tool", config.action_api),
            ("chat", config.chat_api),
        ]
    return [("chat", config.chat_api)]


def _request_with_fallback(
    config: AppConfig,
    purpose: str,
    messages: List[Dict[str, Any]],
    *,
    temperature: float,
    timeout: int,
) -> Dict[str, Any]:
    attempts: List[Dict[str, str]] = []
    for route_name, provider in _provider_route(config, purpose):
        if not _provider_ready(provider):
            attempts.append(
                {
                    "route": route_name,
                    "provider": _provider_name(provider),
                    "status": "skipped",
                }
            )
            continue
        try:
            response = request_chat_completion(
                provider,
                messages,
                stream=False,
                temperature=temperature,
                timeout=timeout,
            )
            return {
                "response": response,
                "route": route_name,
                "provider": _provider_name(provider),
                "model": getattr(provider, "model", ""),
                "attempts": attempts,
            }
        except Exception as error:
            attempts.append(
                {
                    "route": route_name,
                    "provider": _provider_name(provider),
                    "status": f"failed: {error}",
                }
            )
    raise ValueError(f"no available provider for {purpose}; attempts={attempts}")


def prepare_shared_link_context(
    config: AppConfig, url: str, user_note: str = ""
) -> Dict[str, Any]:
    fetched = _fetch_url_content(url)
    context_text = fetched["excerpt"]
    route_used = "fetch_only"
    provider_used = "none"
    try:
        routed = _request_with_fallback(
            config,
            "link",
            [
                {
                    "role": "system",
                    "content": (
                        "You are a tool-side preprocessing model. Read the webpage excerpt and turn it into compact context for a main companion chat model. "
                        "Answer in Chinese. Include: what the page is about, what may be worth sharing, and any uncertainty if content is incomplete. "
                        "Do not speak to the user directly. Do not use pet names or companion tone. Keep it under 220 Chinese characters."
                    ),
                },
                {
                    "role": "user",
                    "content": f"链接：{url}\n用户备注：{user_note or '无'}\n网页摘录：\n{fetched['excerpt']}",
                },
            ],
            temperature=0.2,
            timeout=20,
        )
        context_text = extract_text_content(routed["response"]) or context_text
        route_used = str(routed["route"])
        provider_used = str(routed["provider"])
    except Exception as error:
        context_text = f"网页摘录：{fetched['excerpt']}\n工具模型整理失败，保留原始摘录。错误：{error}"
    return {
        "type": "shared_link",
        "url": url,
        "note": user_note,
        "excerpt": fetched["excerpt"],
        "context": context_text,
        "route_used": route_used,
        "provider_used": provider_used,
    }


def prepare_image_context(
    config: AppConfig,
    image_url: str,
    user_note: str = "",
    workspace_root: Optional[Path] = None,
) -> Dict[str, Any]:
    fallback_context = f"图片来源：{image_url}\n用户备注：{user_note or '无'}"
    route_used = "unavailable"
    provider_used = "none"
    try:
        image_data_url = _image_source_as_data_url(
            image_url, _allowed_workspace_root(workspace_root)
        )
        routed = _request_with_fallback(
            config,
            "image",
            [
                {
                    "role": "system",
                    "content": (
                        "You are a tool-side vision model. Analyze the image and produce compact context for a main companion chat model. "
                        "Answer in Chinese. Include what is visible, the likely mood or scene, and any uncertainty. "
                        "Do not speak to the user directly. Keep it under 220 Chinese characters."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"请识别这张图，整理成给主聊天模型用的上下文。用户备注：{user_note or '无'}",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_data_url},
                        },
                    ],
                },
            ],
            temperature=0.2,
            timeout=30,
        )
        route_used = str(routed["route"])
        provider_used = str(routed["provider"])
        context_text = extract_text_content(routed["response"]) or fallback_context
    except Exception as error:
        context_text = f"{fallback_context}\n识图模型暂时不可用，无法可靠分析图片内容。错误：{error}"
    return {
        "type": "image",
        "url": image_url,
        "note": user_note,
        "context": context_text,
        "route_used": route_used,
        "provider_used": provider_used,
    }


def prepare_search_context(config: AppConfig, query: str) -> Dict[str, Any]:
    routed = _request_with_fallback(
        config,
        "search",
        [
            {
                "role": "system",
                "content": (
                    "You are a search and research model. Answer in Chinese with compact context for a main companion chat model. "
                    "Summarize what is worth knowing, what may be worth sharing, and mention uncertainty if freshness cannot be guaranteed. "
                    "Do not speak to the user directly. Keep it under 260 Chinese characters."
                ),
            },
            {
                "role": "user",
                "content": query,
            },
        ],
        temperature=0.2,
        timeout=25,
    )
    return {
        "type": "search",
        "query": query,
        "context": extract_text_content(routed["response"]),
        "route_used": routed["route"],
        "provider_used": routed["provider"],
        "model": routed["model"],
    }


def build_default_registry(
    workspace_root: Path,
    config_getter: Callable[[], AppConfig],
    *,
    memory_store: Any = None,
    runtime_store: Any = None,
    dispatch_message: Optional[Callable[[str, str, str], Dict[str, Any]]] = None,
) -> ToolRegistry:
    registry = ToolRegistry()
    mcp_bridge = McpBridge(config_getter)

    def fetch_url(args: Dict[str, Any]) -> Dict[str, Any]:
        url = str(args.get("url", "")).strip()
        if not url:
            raise ValueError("url is required")
        fetched = _fetch_url_content(url)
        return {"url": fetched["url"], "content": fetched["content"]}

    def read_file(args: Dict[str, Any]) -> Dict[str, Any]:
        file_path = str(args.get("path", "")).strip()
        if not file_path:
            raise ValueError("path is required")
        target = (
            (workspace_root / file_path).resolve()
            if not Path(file_path).is_absolute()
            else Path(file_path)
        )
        if not str(target).startswith(str(workspace_root.resolve())):
            raise ValueError("path escapes workspace")
        return {
            "path": str(target),
            "content": target.read_text(encoding="utf-8")[:12000],
        }

    def search_web(args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query", "")).strip()
        if not query:
            raise ValueError("query is required")
        try:
            prepared = prepare_search_context(config_getter(), query)
        except Exception as error:
            return {
                "query": query,
                "available": False,
                "note": str(error),
                "results": [],
            }
        context = str(prepared.get("context", "") or "").strip()
        route_used = str(prepared.get("route_used", "") or "")
        available = bool(context) and route_used not in {"unavailable", "failed"}
        return {
            "query": query,
            "available": available,
            "model": prepared.get("model", ""),
            "summary": context,
            "route_used": route_used,
            "provider_used": prepared.get("provider_used", ""),
            "note": "" if available else context or "search unavailable",
        }

    def search_memory(args: Dict[str, Any]) -> Dict[str, Any]:
        if memory_store is None:
            raise ValueError("memory store is not available")
        query = str(args.get("query", "")).strip()
        if not query:
            raise ValueError("query is required")
        limit = max(1, min(20, int(args.get("limit", 8) or 8)))
        injected_categories = {
            "preference",
            "promise",
            "anniversary",
            "identity",
            "relationship",
        }
        results = [
            item
            for item in memory_store.search(query, limit=max(limit * 2, 12))
            if getattr(item, "category", "") not in injected_categories
            and getattr(item, "category", "") != "memory_refresh"
        ][:limit]
        return {
            "query": query,
            "items": [
                {
                    "id": item.id,
                    "key": item.key,
                    "content": item.content,
                    "category": item.category,
                    "importance": item.importance,
                    "session_id": item.session_id,
                    "final_score": item.final_score,
                }
                for item in results
            ],
        }

    def save_memory(args: Dict[str, Any]) -> Dict[str, Any]:
        if memory_store is None:
            raise ValueError("memory store is not available")
        key = str(args.get("key", "")).strip()
        content = str(args.get("content", "")).strip()
        if not key or not content:
            raise ValueError("key and content are required")
        category = str(args.get("category", "other")).strip() or "other"
        importance = float(args.get("importance", 0.5) or 0.5)
        importance = max(0.0, min(1.0, importance))
        memory_id = args.get("id", "").strip() if args.get("id") else ""
        if not memory_id:
            memory_id = f"mem_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
        record = memory_store.upsert_memory(
            memory_id=memory_id,
            key=key,
            content=content,
            category=category,
            importance=importance,
        )
        return {
            "ok": True,
            "id": record.id,
            "key": record.key,
            "content": record.content,
            "category": record.category,
            "importance": record.importance,
        }

    def create_reminder(args: Dict[str, Any]) -> Dict[str, Any]:
        if runtime_store is None:
            raise ValueError("runtime store is not available")
        profile_id = str(args.get("profile_id", "local-user") or "local-user").strip()
        content = str(args.get("content", "") or args.get("reason", "")).strip()
        if not content:
            raise ValueError("content is required")
        trigger_at = str(args.get("trigger_at", "")).strip()
        minutes = int(args.get("minutes", 0) or 0)
        metadata = dict(args.get("metadata") or {})
        if minutes > 0:
            metadata.setdefault("requested_minutes", minutes)
        if not trigger_at:
            if minutes <= 0:
                raise ValueError("trigger_at or minutes is required")
            trigger_at = (datetime.utcnow() + timedelta(minutes=minutes)).isoformat()
        for existing in runtime_store.list_reminders(
            profile_id=profile_id, status="pending", limit=100
        ):
            existing_minutes = int(
                (existing.metadata or {}).get("requested_minutes", 0) or 0
            )
            same_relative_reminder = (
                minutes > 0
                and existing.content == content
                and existing_minutes == minutes
            )
            same_absolute_reminder = (
                existing.content == content and existing.trigger_at == trigger_at
            )
            if same_relative_reminder or same_absolute_reminder:
                return {
                    "reminder_id": existing.reminder_id,
                    "profile_id": existing.profile_id,
                    "content": existing.content,
                    "trigger_at": existing.trigger_at,
                    "status": existing.status,
                    "deduplicated": True,
                }
        reminder_id = f"rem_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
        reminder = runtime_store.create_reminder(
            reminder_id=reminder_id,
            profile_id=profile_id,
            content=content,
            trigger_at=trigger_at,
            channel=str(args.get("channel", "") or "").strip(),
            metadata=metadata,
        )
        return {
            "reminder_id": reminder.reminder_id,
            "profile_id": reminder.profile_id,
            "content": reminder.content,
            "trigger_at": reminder.trigger_at,
            "status": reminder.status,
        }

    def send_proactive_message(args: Dict[str, Any]) -> Dict[str, Any]:
        if dispatch_message is None:
            raise ValueError("message dispatcher is not available")
        profile_id = str(args.get("profile_id", "")).strip()
        content = str(args.get("content", "")).strip()
        if not profile_id or not content:
            raise ValueError("profile_id and content are required")
        return dispatch_message(profile_id, content, "manual_proactive")

    def read_shared_link(args: Dict[str, Any]) -> Dict[str, Any]:
        url = str(args.get("url", "")).strip()
        user_note = str(args.get("note", "")).strip()
        if not url:
            raise ValueError("url is required")
        prepared = prepare_shared_link_context(config_getter(), url, user_note)
        return {
            "url": url,
            "available": True,
            "model": config_getter().action_api.model or config_getter().chat_api.model,
            "excerpt": prepared["excerpt"],
            "context": prepared["context"],
            "route_used": prepared["route_used"],
            "provider_used": prepared["provider_used"],
            "note": "This tool output is meant to be injected into the main chat model context, not sent to the user directly.",
        }

    def analyze_image(args: Dict[str, Any]) -> Dict[str, Any]:
        image_url = str(
            args.get("url", "") or args.get("image_url", "") or args.get("path", "")
        ).strip()
        user_note = str(args.get("note", "")).strip()
        if not image_url:
            raise ValueError("url or path is required")
        prepared = prepare_image_context(
            config_getter(),
            image_url,
            user_note,
            _allowed_workspace_root(workspace_root),
        )
        context = str(prepared.get("context", "") or "").strip()
        route_used = str(prepared.get("route_used", "") or "")
        available = bool(context) and route_used not in {"unavailable", "failed"}
        return {
            "url": image_url,
            "available": available,
            "context": context,
            "route_used": route_used,
            "provider_used": prepared.get("provider_used", ""),
            "note": "This tool output is meant to be injected into the main chat model context, not sent to the user directly.",
        }

    def call_mcp(args: Dict[str, Any]) -> Dict[str, Any]:
        server = str(args.get("server", "")).strip()
        tool = str(args.get("tool", "")).strip()
        if not server or not tool:
            raise ValueError("server and tool are required")
        result = mcp_bridge.call_tool(server, tool, args.get("arguments") or {})
        return result

    registry.register(
        ToolSpec(
            tool_id="fetch_url",
            description="Fetch a web page and return cleaned text content.",
            schema={
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
            enabled=True,
            execute=fetch_url,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="read_file",
            description="Read a local workspace file.",
            schema={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
            enabled=True,
            execute=read_file,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="search_web",
            description="Search the web through a configured search provider.",
            schema={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            enabled=True,
            execute=search_web,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="search_memory",
            description="Search archived memories through the SQLite hybrid memory store.",
            schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["query"],
            },
            enabled=memory_store is not None,
            execute=search_memory,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="save_memory",
            description="Save or update a memory record. Use this to persist important user information such as preferences, promises, events, anniversaries, habits, or any fact worth remembering long-term.",
            schema={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Short title or label for the memory",
                    },
                    "content": {
                        "type": "string",
                        "description": "Detailed content of the memory",
                    },
                    "category": {
                        "type": "string",
                        "enum": [
                            "preference",
                            "promise",
                            "event",
                            "anniversary",
                            "emotion",
                            "habit",
                            "boundary",
                            "other",
                        ],
                        "description": "Category of the memory",
                    },
                    "importance": {
                        "type": "number",
                        "description": "Importance from 0.0 to 1.0 (default 0.5)",
                    },
                    "id": {
                        "type": "string",
                        "description": "Optional: existing memory ID to update instead of creating new",
                    },
                },
                "required": ["key", "content"],
            },
            enabled=memory_store is not None,
            execute=save_memory,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="read_shared_link",
            description="Fetch a shared link and turn it into compact tool context for the main chat model.",
            schema={
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["url"],
            },
            enabled=True,
            execute=read_shared_link,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="create_reminder",
            description="Create a reminder that will be delivered by the gateway scheduler.",
            schema={
                "type": "object",
                "properties": {
                    "profile_id": {"type": "string"},
                    "content": {"type": "string"},
                    "minutes": {"type": "integer"},
                    "trigger_at": {"type": "string"},
                    "channel": {"type": "string"},
                },
                "required": ["content"],
            },
            enabled=runtime_store is not None,
            execute=create_reminder,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="send_proactive_message",
            description="Send a proactive message through the gateway's last known channel for a profile.",
            schema={
                "type": "object",
                "properties": {
                    "profile_id": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["profile_id", "content"],
            },
            enabled=dispatch_message is not None,
            execute=send_proactive_message,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="analyze_image",
            description="Analyze an image through the tool-model route and produce compact context for the main chat model.",
            schema={
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["url"],
            },
            enabled=True,
            execute=analyze_image,
        )
    )
    registry.register(
        ToolSpec(
            tool_id="call_mcp",
            description="Call a configured MCP server tool.",
            schema={
                "type": "object",
                "properties": {
                    "server": {"type": "string"},
                    "tool": {"type": "string"},
                    "arguments": {"type": "object"},
                },
                "required": ["server", "tool"],
            },
            enabled=True,
            execute=call_mcp,
        )
    )
    return registry
