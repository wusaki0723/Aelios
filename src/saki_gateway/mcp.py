from __future__ import annotations

import json
import os
import selectors
import subprocess
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .config import McpServerConfig


@dataclass
class McpToolInfo:
    name: str
    description: str
    input_schema: Dict[str, Any]


class McpBridge:
    def __init__(self, config_getter):
        self.config_getter = config_getter

    def list_servers(self) -> List[Dict[str, Any]]:
        config = self.config_getter()
        servers = []
        for server in config.mcp_servers:
            servers.append(
                {
                    "name": server.name,
                    "enabled": server.enabled,
                    "command": server.command,
                    "args": list(server.args),
                }
            )
        return servers

    def list_tools(self, server_name: str, timeout: int = 12) -> Dict[str, Any]:
        server = self._resolve_server(server_name)
        with _StdioMcpSession(server, timeout=timeout) as session:
            result = session.request("tools/list", {})
        tools = []
        for item in result.get("tools", []) or []:
            tools.append(
                McpToolInfo(
                    name=str(item.get("name", "")),
                    description=str(item.get("description", "")),
                    input_schema=item.get("inputSchema") or {},
                ).__dict__
            )
        return {"server": server.name, "tools": tools}

    def call_tool(self, server_name: str, tool_name: str, arguments: Optional[Dict[str, Any]] = None, timeout: int = 20) -> Dict[str, Any]:
        server = self._resolve_server(server_name)
        with _StdioMcpSession(server, timeout=timeout) as session:
            result = session.request(
                "tools/call",
                {
                    "name": tool_name,
                    "arguments": arguments or {},
                },
            )
        return {
            "server": server.name,
            "tool": tool_name,
            "content": result.get("content", []),
            "structuredContent": result.get("structuredContent"),
            "isError": bool(result.get("isError", False)),
        }

    def _resolve_server(self, server_name: str) -> McpServerConfig:
        config = self.config_getter()
        for server in config.mcp_servers:
            if server.name == server_name and server.enabled:
                if not server.command:
                    raise ValueError(f"mcp server '{server_name}' command is required")
                return server
        raise KeyError(f"mcp server '{server_name}' is not enabled")


class _StdioMcpSession:
    def __init__(self, server: McpServerConfig, timeout: int = 15):
        self.server = server
        self.timeout = timeout
        self.proc: Optional[subprocess.Popen[bytes]] = None
        self._request_id = 0

    def __enter__(self):
        command = [self.server.command, *self.server.args]
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "saki-gateway", "version": "0.2.0"},
            },
        )
        self.notify("notifications/initialized", {})
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.proc is None:
            return False
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=1.5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        return False

    def notify(self, method: str, params: Dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._request_id += 1
        request_id = self._request_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"mcp request timed out: {method}")
            message = self._read_message(remaining)
            if message.get("id") != request_id:
                continue
            if "error" in message:
                error = message["error"] or {}
                raise ValueError(f"mcp {method} failed: {error}")
            return message.get("result") or {}

    def _send(self, payload: Dict[str, Any]) -> None:
        if self.proc is None or self.proc.stdin is None:
            raise RuntimeError("mcp process is not ready")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        self.proc.stdin.write(header + body)
        self.proc.stdin.flush()

    def _read_message(self, timeout: float) -> Dict[str, Any]:
        if self.proc is None or self.proc.stdout is None:
            raise RuntimeError("mcp process is not ready")
        stdout = self.proc.stdout
        selector = selectors.DefaultSelector()
        selector.register(stdout, selectors.EVENT_READ)
        try:
            header_bytes = bytearray()
            while b"\r\n\r\n" not in header_bytes:
                chunk = self._read_available(stdout.fileno(), selector, timeout, 1)
                if not chunk:
                    raise ValueError("mcp server closed the connection")
                header_bytes.extend(chunk)
            raw_header, remainder = bytes(header_bytes).split(b"\r\n\r\n", 1)
            headers: Dict[str, str] = {}
            for line in raw_header.decode("utf-8", errors="replace").split("\r\n"):
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()
            content_length = int(headers.get("content-length", "0") or "0")
            if content_length <= 0:
                raise ValueError("invalid mcp content-length")
            body = bytearray(remainder)
            while len(body) < content_length:
                body.extend(self._read_available(stdout.fileno(), selector, timeout, content_length - len(body)))
            return json.loads(bytes(body[:content_length]).decode("utf-8", errors="replace"))
        finally:
            selector.close()

    def _read_available(self, fd: int, selector: selectors.BaseSelector, timeout: float, size: int) -> bytes:
        events = selector.select(timeout)
        if not events:
            raise TimeoutError("mcp server did not respond in time")
        return os.read(fd, max(size, 1))
