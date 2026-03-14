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


## Short-term memory files (Phase 4 slice 1)
`data/core_profile.md` now renders in structured sections:
- `About Her`
- `Relationship Core`
- `My Profile`

`data/active_memory.md` now renders in structured sections:
- `Current Status`
- `Purpose Context`
- `On the Horizon`
- `Others`

Both files keep a backward-compatible timestamp header and add a format marker (`core_profile.v2` / `active_memory.v2`). Rendering is bounded by per-section item limits and per-item character limits to keep prompt token usage stable.


## Nightly digest scheduler (Phase 4 slice 2)
- Scheduler now uses local timezone-aware evaluation and triggers nightly digest once per local date at **04:05**.
- Timezone is configurable via `scheduler.local_timezone` (or env `SAKI_LOCAL_TIMEZONE`). If invalid/missing, gateway falls back to server local timezone.
- Digest run state is persisted to `memory.digest_run_state_path` (default `./data/digest_run_state.json`) with fields:
  - `id`, `run_state`, `status`, `started_at`, `completed_at`, `error_message`
- Idempotency behavior:
  - If a date already completed with `success`, scheduler records skip and does not rerun that date.
  - If a run fails (for example Trilium unavailable), status becomes `failed` and a later tick can retry safely.
- Digest inputs include recent 24h messages, tool execution events, active memory snapshot, and optional recent durable memories.
- Digest output refreshes `active_memory.md` and upserts one Trilium note under `AI Companion Workspace / Daily Digest / YYYY-MM-DD daily digest` (best-effort, graceful failure).

TODOs:
- core profile proposal queue (`pending_core_updates`) is intentionally out-of-scope for slice 2.
- durable-memory archival strategy remains intentionally minimal in this slice.


## Core profile protection + proposal workflow (Phase 4 slice 3)
- `core_profile.md` is protected: automatic jobs must not silently overwrite core sections.
- `active_memory.md` may still refresh automatically.
- Candidate core changes are stored in SQLite table `pending_core_updates` with fields:
  - `id`, `target_section`, `proposed_content`, `reason`, `source_context`, `fingerprint`, `proposal_type`, `confidence`, `status`, `created_at`, `updated_at`, `reviewed_at`
- `proposal_type` is constrained in practice to: `identity | preference | goal | relationship | routine | other`
- `confidence` is constrained in practice to: `low | medium | high`
- `target_section` is validated to the real core sections only:
  - `About Her`, `Relationship Core`, `My Profile`
- Fingerprint purpose:
  - deduplicate semantically same open proposals based on normalized section + normalized content
  - normalization collapses whitespace and strips trivial markdown-only prefixes
- Dedup behavior:
  - if same fingerprint already exists in `open` status, no new row is inserted; existing row `updated_at` is touched and context can be merged
  - approved/rejected history is preserved
- Review lifecycle (backend):
  - `open` -> `approved` performs section-aware semantic merge (dedupe + conservative conflict handling) and sets `reviewed_at`
  - `open` -> `rejected` keeps `core_profile` unchanged and sets `reviewed_at`
- Merge behavior for approval:
  - integrates meaningfully new entries once into the target section
  - suppresses strongly overlapping duplicates
  - handles likely conflicts conservatively (logs conflict, does not overwrite existing safer fact)

Known limitations:
- UI review panel is not included in this slice (backend operations only).
- Semantic merge is intentionally conservative; richer contradiction resolution and ontology-aware merging remain TODO.

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
