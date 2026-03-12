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
