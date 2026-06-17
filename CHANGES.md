# LMC-5 XYZEM Memory Migration

## Summary

This branch ports the LMC-5 five-axis memory model into Aelios while keeping D1 as the single memory store and Vectorize as the embedding index only.

## Schema

Migration `migrations/0003_lmc5_xyzem.sql` adds nullable XYZEM columns to `memories`:

- `fact_key`
- `thread`
- `risk_level`
- `urgency_level`
- `tension_score`
- `response_posture`

It also creates `memory_relations`:

- `id`
- `namespace`
- `source_id`
- `target_id`
- `relation_type`
- `strength`
- `created_at`

Z-axis conflict audits and M-axis patrol output reuse `memory_events`; no separate audit table is introduced.

Before applying the migration remotely, export D1 first:

```sh
npx wrangler d1 export companion_memory_proxy --remote --output backups/d1-before-0003.sql
npx wrangler d1 migrations apply companion_memory_proxy --remote
```

## Backend Unification

- Public memory API, MCP tools, chat memory injection, nightly dream, and debug reindex now use D1 as the source of truth.
- Vectorize is retained only as the vector index populated from D1 rows.
- `MEMORY_BACKEND` was removed from `wrangler.toml`, setup visibility, README, and `Env`.
- The old Vectorize metadata store functions were removed; `src/memory/vectorStore.ts` now only parses Vectorize metadata for debug display.

## Write Path

- `src/memory/merge.ts` now prefers `fact_key` when choosing supersede targets.
- If no `fact_key` match exists, it falls back to the previous similarity/LLM merge decision path.
- Superseded records are marked `status='superseded'` and kept in D1 for audit.
- Supersede writes a `memory_events` row with `event_type='z_conflict'`.
- Pinned memories remain protected from merge/supersede/delete behavior.

## Nightly Maintenance

`src/memory/xyzem.ts` adds three scheduled passes, wired from `src/index.ts` after dream batches:

- `z-audit`: finds multiple active/review memories with the same `fact_key`, logs a `z_audit` event, and marks non-pinned active conflicts as `review`.
- `patrol`: emits M-axis review suggestions to `memory_events` without silently deleting or rewriting memories.
- `relation-build`: builds safe `same_topic` and `temporal_sequence` Y-axis edges for recent memories. Risky relation types such as `contradicts`, `cause_effect`, and `supports` are written as `y_relation_review` events instead of being auto-applied.

## Recall

`src/memory/search.ts` keeps the existing Vectorize to D1 to text-fallback recall path and adds:

- Y-axis two-hop relation expansion with relation type and distance decay.
- E-axis resonance using `risk_level`, `urgency_level`, and `tension_score`.
- Score merge by memory id, keeping the highest score before final sorting.

The `MemoryApiRecord` response shape remains backward-compatible with extra nullable fields.

## Backfill

`scripts/backfill-xyzem-memories.mjs` backfills existing memories with DeepSeek:

```sh
AELIOS_BASE_URL=https://companion-memory-proxy.example.workers.dev \
AELIOS_API_KEY=... \
DEEPSEEK_API_KEY=... \
npm run memory:backfill-xyzem
```

Default mode is dry-run. It writes a plan to `backups/xyzem-backfill-plan-*.json` and does not mutate D1.

To apply a reviewed plan:

```sh
AELIOS_BASE_URL=https://companion-memory-proxy.example.workers.dev \
AELIOS_API_KEY=... \
DEEPSEEK_API_KEY=... \
npm run memory:backfill-xyzem -- --resume backups/xyzem-backfill-plan-YYYY.json --apply
```

`--apply` first runs:

```sh
npx wrangler d1 export companion_memory_proxy --remote --output backups/d1-companion_memory_proxy-before-xyzem-backfill-*.sql
```

Then it patches memory coordinates through the Worker API. Safe relation candidates are inserted into `memory_relations`; risky relation candidates are written to `memory_events` as `y_relation_review`.

Useful knobs:

- `--namespace default`
- `--batch-size 20`
- `--limit-batches 3`
- `--resume backups/xyzem-backfill-plan-*.json`
- `--max-relations 250`
- `XYZEM_BACKFILL_MODEL=deepseek-chat`
- `D1_DATABASE_NAME=companion_memory_proxy`

## Manual Review Queue

Review these before applying or acting on them:

- `memory_events.event_type='z_audit'`
- `memory_events.event_type='m_patrol'`
- `memory_events.event_type='y_relation_review'`

Contradictions, cause/effect claims, support claims, high-risk facts, and multiple current facts under the same `fact_key` should be reviewed manually rather than silently merged.

## Decisions

- D1 is the single source of truth; Vectorize never owns memory content.
- New XYZEM fields are nullable so old memories continue to recall normally before backfill.
- `review`, `historical`, and `archived` are accepted as status values by convention; the existing D1 schema has no status CHECK constraint to rewrite.
- Backfill is intentionally plan-first and dry-run by default because it touches production memory content.
