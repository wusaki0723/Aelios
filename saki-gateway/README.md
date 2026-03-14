# Aelios Saki Gateway (Sanitized OSS Build)

This is a sanitized open-source version of the Python gateway used to power multi-channel chat, memory, reminders, web/image tools, and channel integrations.

## Included
- Python gateway runtime
- Feishu / QQBot channel integrations
- Memory store, runtime store, reminder scheduler
- Search / fetch / image-analysis tool plumbing

## Excluded from this OSS build
- Personal memories, conversation logs, profiles
- API keys, app tokens, webhook secrets
- Private PM2 / deployment specifics

## Quick start
1. Create a virtualenv
2. Install from `pyproject.toml`
3. Copy `data/config.example.json` to `data/config.json`
4. Fill your own provider and channel credentials
5. Run `python -m saki_gateway`

## Notes
This repository is intentionally sanitized for open-source release.

## Memory prompt flow
The runtime reply path now uses a cache-stable prompt order:
1. base persona/system prompt
2. fixed important memories (`importance = 1`)
3. today log
4. recent session context
5. latest user message
6. late-bound supplemental memory from the action runtime

The action runtime no longer relies on `search_memory` during normal replies. Instead, the gateway precomputes a candidate pool from non-fixed long-term memories plus today/yesterday logs, and the action runtime selects only concise missing details worth appending at the end.

## Human-like message segmentation
Feishu and QQBot outbound text now prefer newline-based segmentation. Each non-empty line is sent as an individual message segment, with a short configurable delay between segments, and long lines still fall back to chunking by `send_chunk_chars`.

## Privacy / sanitization
This OSS build excludes personal memories, private profiles, live API keys/tokens, and conversation logs. Use `data/config.example.json` as the template for local configuration; create your own untracked `data/config.json` when deploying.

## Trilium integration (Phase 1)
The gateway now includes a Trilium client module for deployment integration groundwork.

Environment variables:
- `TRILIUM_ENABLED`
- `TRILIUM_URL`
- `TRILIUM_ETAPI_TOKEN` (recommended)
- `TRILIUM_TOKEN` (backward-compatible fallback)
- `TRILIUM_TIMEOUT_SECONDS` (optional, default `10`)

Current client surface (`saki_gateway.trilium.TriliumClient`):
- `health_check()`
- `search_notes(query, limit=5, parent_note_id=None)`
- `get_note(note_id)`
- `get_note_content(note_id)`
- `list_children(parent_note_id)`

Behavior:
- Uses bounded request timeout.
- Returns safe fallbacks (`[]`, `None`, or `""`) when Trilium is down or unreachable.
- Avoids credential leakage by never exposing `TRILIUM_TOKEN` in public config payloads.


Phase 2 gateway tools are now available when Trilium is enabled and configured:
- `search_trilium`
- `get_trilium_note`

Routing rule in system prompt: for diary notes / study notes / book notes / "my notes", the model is instructed to call `search_trilium` first and then `get_trilium_note`.


## Manual E2E test case (Trilium read-only flow)
1. Set env vars and start gateway:
   - `TRILIUM_ENABLED=true`
   - `TRILIUM_URL=http://<your-trilium-host>`
   - `TRILIUM_ETAPI_TOKEN=<your-etapi-token>`
2. In chat, send: `帮我找一下我的学习笔记里关于线性代数的内容`
3. Confirm tool behavior in logs / tool events:
   - first `search_trilium` runs and injects only compact candidates (titles + ids)
   - then `get_trilium_note` runs for one selected note and injects truncated/compact content
4. Validate result distinction:
   - if Trilium is down/unreachable: assistant should indicate **Trilium unavailable**
   - if Trilium is healthy but query returns empty: assistant should indicate **no notes found**
5. Send an ordinary chat message like `今天心情有点低落` and confirm Trilium tools are not triggered unless notes are explicitly requested.
