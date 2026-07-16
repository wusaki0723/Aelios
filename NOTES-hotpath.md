# NOTES — hotpath work (seen, not touched)

Per SPEC-hotpath.md: record extras observed during implementation; leave code alone.

## Explicitly out of scope (from SPEC)

1. **index.ts router refactor** (review item 11) — skipped.
2. **Queue-based retry for vector upsert failures** (review item 12) — skipped.
   - `updateVectorMemory` / vector upsert paths still `console.error` and continue on Vectorize failure; no durable retry queue.

## Observed during implementation (not changed)

3. **`saveIngestMessages`** (`src/db/messages.ts`) still does plain INSERT without `client_message_hash`. Only user-message path via `saveUserMessages` is idempotent; ingest/GitHub daily paths remain non-deduped by design (existing comment in `githubDaily.ts`).
4. **`saveAssistantMessage`** does not use `client_message_hash` — left untouched as specified.
5. **Boot package cache** is per-worker-isolate with plain 60s TTL and no invalidation on precious/glossary writes. Stale boot content for up to 60s is accepted by SPEC; explicit invalidation would need write-path hooks.
6. **`markMemoriesRecalled`** on non-chat callers (MCP search, dailyDigest, admin recall APIs) still awaits on the request path — only chat hot path + `runRecall` with `waitUntil` offload it.
7. **`listPrecious` limit mismatch**: chat chain B uses limit 50 for fingerprint, then `buildBootPackage` slices to 20; MCP boot uses limit 20 inside package. Cache key is namespace-only, so first warm caller wins for 60s.
8. **D1 `INSERT OR IGNORE` + unique partial index** requires migration `0010` applied in each environment before production traffic can rely on DB-level uniqueness (code path already handles ignore + lookup).

## Idempotency semantics (P0 fixup)

9. **Eternal conversations:** `getOrCreateConversation` uses id `${namespace}:default` — one conversation per namespace forever. A hash of `conversationId:role:content` alone collides for every legitimate repeat of the same text across time (e.g. user saying "晚安" on different days). Content-only uniqueness would both delete historical repeats in a destructive migration and silently drop future legitimate repeats.
10. **Time-bucketed hash:** `saveUserMessages` hashes `conversationId:role:normalizeContent(content):bucket` where `bucket = Math.floor(Date.now() / 600_000)` (10-minute windows). Client retries seconds apart still dedupe via `INSERT OR IGNORE` + lookup-by-hash; the same text in a different 10-minute bucket inserts as a new row. A retry that straddles a bucket boundary may create a duplicate — accepted, rare, and strictly better than dropping real messages.
11. **Migration `0010` is non-destructive:** it nulls all existing `client_message_hash` values (old content-only format is incompatible with the bucketed format and may contain legitimate duplicates), drops the non-unique `idx_messages_hash`, and creates partial unique `idx_messages_hash_unique`. No `DELETE` — every historical row is preserved.
