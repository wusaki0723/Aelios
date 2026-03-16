from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, List, Optional


def build_chat_completion_payload(
    messages: List[Dict[str, str]],
    model: str,
    *,
    stream: bool = False,
    temperature: float = 0.7,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
) -> Dict[str, Any]:
    if not model:
        raise ValueError("model is required")
    if not messages:
        raise ValueError("messages are required")
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": stream,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice
    return payload


def request_chat_completion(
    provider: Any,
    messages: List[Dict[str, str]],
    *,
    stream: bool = False,
    temperature: float = 0.7,
    timeout: int = 45,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
) -> Dict[str, Any]:
    provider_name = getattr(provider, "label", None) or getattr(provider, "backend_type", None) or "unknown"
    if not getattr(provider, "enabled", False):
        raise ValueError(f"provider '{provider_name}' is disabled")
    if not getattr(provider, "base_url", ""):
        raise ValueError(f"provider '{provider_name}' base_url is required")
    if not getattr(provider, "api_key", ""):
        raise ValueError(f"provider '{provider_name}' api_key is required")
    if not getattr(provider, "model", ""):
        raise ValueError(f"provider '{provider_name}' model is required")

    payload = build_chat_completion_payload(
        messages,
        provider.model,
        stream=stream and bool(getattr(provider, "stream", False)),
        temperature=temperature,
        tools=tools,
        tool_choice=tool_choice,
    )
    base_url = str(getattr(provider, "base_url", "") or "").rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    request_url = base_url
    if not parsed.path.endswith("/chat/completions"):
        request_url = base_url + "/chat/completions"

    request = urllib.request.Request(
        request_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {provider.api_key}",
            "User-Agent": "saki-gateway/0.1",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise ValueError(f"provider request failed: {error.code} {detail}") from error
        except urllib.error.URLError as error:
            last_error = error
            if attempt == 0:
                time.sleep(0.5)
                continue
            raise ValueError(f"provider request failed: {error}") from error
        except TimeoutError as error:
            last_error = error
            if attempt == 0:
                time.sleep(0.5)
                continue
            raise ValueError(f"provider request timed out: {error}") from error
    if last_error is not None:
        raise ValueError(f"provider request failed: {last_error}") from last_error
    raise ValueError("provider request failed: unknown error")


def stream_chat_completion(
    provider: Any,
    messages: List[Dict[str, Any]],
    *,
    temperature: float = 0.7,
    timeout: int = 90,
) -> Iterator[str]:
    provider_name = getattr(provider, "label", None) or getattr(provider, "backend_type", None) or "unknown"
    if not getattr(provider, "enabled", False):
        raise ValueError(f"provider '{provider_name}' is disabled")
    if not getattr(provider, "base_url", ""):
        raise ValueError(f"provider '{provider_name}' base_url is required")
    if not getattr(provider, "api_key", ""):
        raise ValueError(f"provider '{provider_name}' api_key is required")
    if not getattr(provider, "model", ""):
        raise ValueError(f"provider '{provider_name}' model is required")

    if not bool(getattr(provider, "stream", False)):
        response = request_chat_completion(provider, messages, stream=False, temperature=temperature, timeout=timeout)
        content = extract_text_content(response)
        if content:
            yield content
        return

    payload = build_chat_completion_payload(messages, provider.model, stream=True, temperature=temperature)
    base_url = str(getattr(provider, "base_url", "") or "").rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    request_url = base_url
    if not parsed.path.endswith("/chat/completions"):
        request_url = base_url + "/chat/completions"

    request = urllib.request.Request(
        request_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {provider.api_key}",
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
            "User-Agent": "saki-gateway/0.1",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                chunk = _extract_stream_delta(event)
                if chunk:
                    yield chunk
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ValueError(f"provider stream failed: {error.code} {detail}") from error
    except urllib.error.URLError as error:
        raise ValueError(f"provider stream failed: {error}") from error
    except TimeoutError as error:
        raise ValueError(f"provider stream timed out: {error}") from error


def _extract_stream_delta(event: Dict[str, Any]) -> str:
    choices = event.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
                elif isinstance(text, dict):
                    parts.append(str(text.get("value", "")))
        return "".join(parts)
    return ""


def extract_text_content(response: Dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(part for part in parts if part)
    return str(content)


def extract_tool_calls(response: Dict[str, Any]) -> List[Dict[str, Any]]:
    choices = response.get("choices") or []
    if not choices:
        return []
    message = choices[0].get("message") or {}
    tool_calls = message.get("tool_calls") or []
    normalized: List[Dict[str, Any]] = []
    for item in tool_calls:
        if not isinstance(item, dict):
            continue
        function = item.get("function") or {}
        normalized.append(
            {
                "id": str(item.get("id", "") or ""),
                "type": str(item.get("type", "function") or "function"),
                "name": str(function.get("name", "") or ""),
                "arguments": str(function.get("arguments", "") or "{}"),
            }
        )
    if normalized:
        return normalized
    legacy_call = message.get("function_call") or {}
    if isinstance(legacy_call, dict) and legacy_call.get("name"):
        normalized.append(
            {
                "id": "legacy_function_call",
                "type": "function",
                "name": str(legacy_call.get("name", "") or ""),
                "arguments": str(legacy_call.get("arguments", "") or "{}"),
            }
        )
    return normalized


def extract_finish_reason(response: Dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        return ""
    return str(choices[0].get("finish_reason", "") or "")
