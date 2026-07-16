I've completed the review. Below are the findings grouped by the four areas you asked about. I did not modify any files.

## (1) Spec conformance

A/B/C/D and the `不做的事` boundaries are mostly honored — the dedup gate module, A1 advisory note format, A2 three-way return type, B `resolveMemoryFactKey` (body→lifecycle), C target-active supersede + `target_gone_fallback` note, D1 migration, D2 cron-after-weekly + admin endpoint, D3 ladder order + truncate-from-monthly-up, D4 embedding comment + verify assertion all match the spec. Deviations:

1. **`src/memory/v2/recall.ts:140,216`** — minor — `BootPackage.yesterday_log` is now vestigial (computed and serialized but unused by `formatBootStable`, which renders daily via `<impressions>`); stale doc comments at `src/assembler/types.ts:43,145`, `src/assembler/blocks.ts:276`, `src/proxy/anthropicAdapter.ts:554`. Fix: drop `yesterday_log` from `BootPackage` and update the comments.
2. **`src/memory/monthlyRollup.ts:71`** — nit — `readRollupModel` adds a `DAILY_DIGEST_MODEL` fallback beyond the spec's `DIARY_MODEL || DREAM_MODEL`. Fix: drop the extra fallback or document the deviation.
3. **`src/memory/monthlyRollup.ts:162-163`** — nit — monthly prompt says "本周周记" while feeding a whole month's weeks; copy-paste residue from `weeklyRollup`. Fix: "本月周记".

## (2) Correctness bugs

4. **`src/memory/monthlyRollup.ts:306-326`** — **blocker** — `processMonth`'s `already_rolled_up` branch deletes newly-eligible `weekly_log` rows without folding them into the monthly summary. Because a month's weeks cross the 35-day threshold across consecutive runs (weeks span ~28 days; the youngest straggle in after the oldest 2 trigger the first rollup), the first run rolls W1+W2 and creates `monthly_log`; W3/W4/W5 then arrive in later runs, hit `existingMonthly != null`, and are silently deleted — never summarized. Both the weekly and monthly views lose those weeks. Fix: when `existingMonthly`, re-run the model over the new weeks (or merge with the existing summary) and `upsert` the refreshed `monthly_log` before deleting.
5. **`src/memory/dedupGate.ts:10-13`** — major — `isActiveNonSuperseded` checks `memory.version_status === "superseded"`, but `vectorMetadataToMemoryRecord` (`src/memory/vectorStore.ts:108-144`) never populates `version_status` on search results, so the check is dead code. The gate depends entirely on Vectorize's `status:"active"` filter plus `supersedeMemory`'s `deleteByIds` (`src/db/v2.ts:1115-1121`, which only logs on failure). If a `deleteByIds` fails, the superseded vector stays searchable and the next similar approve re-supersedes it, creating duplicate active vectors that never self-heal. Fix: store `version_status` in vector metadata and populate it, or drop the misleading check and harden the `deleteByIds` retry.
6. **`src/memory/dailyDigest.ts:937`** — minor — `resolveMemoryFactKey` (`src/db/v2.ts:889-906`) doesn't filter by memory status. For a `dream_update` whose target is already superseded, the candidate inherits a `fact_key` that may now belong to a different active memory; at approve, `upsertMemoryByFactKey` would then update that other memory. Fix: only inherit when the target is `active`/`current`, else return null.
7. **`src/assembler/types.ts:180-186`** — minor — `buildImpressionsLadder` truncates by whole tiers; if the daily line alone exceeds `max_chars` it returns `[]`, dropping the daily anchor entirely. Fix: always keep the daily line and truncate its summary in place when the budget is too small.
8. **`src/memory/monthlyRollup.ts:434-437`** — minor — orphan months (rows<2) are filtered out of `eligibleMonths` and never appear in `details`/`months_eligible`, so the stats under-report pending orphans (weeks are retained correctly). Fix: iterate `byMonth` and push `processMonth`'s `skipped/orphan_weeks` detail for them too.

## (3) Style consistency

9. **`src/memory/monthlyRollup.ts:17`** — nit — `DEFAULT_TIME_ZONE = "Asia/Singapore"` while `recall.ts:186` and the dream pipeline use `"Asia/Shanghai"`. Fix: align to `Asia/Shanghai` (or reuse `readDreamTimeZoneFromEnv`'s default).
10. **`src/memory/dedupGate.ts:18`** — nit — `excludeIds` is accepted but never passed by either call site (`dailyDigest.ts:756`, `memories.ts:724`). Fix: use it (e.g. exclude the candidate's own target at approve) or drop the parameter.

## (4) `scripts/verify-dedup-gate.mjs` — does it really exercise a–e?

11. **`scripts/verify-dedup-gate.mjs:94-266,287-444`** — major — the behavioral section tests a parallel mock reimplementation (`mockFindSimilarActiveMemory`, `mockSupersedeMemory`, `mockCreateApprovedMemoryFromCandidate`, `mockApproveCandidate`), not the real `src/api/memories.ts` / `src/memory/dedupGate.ts` / `src/db/v2.ts` code. Branches a–e are exercised against the mocks; only the static regex checks (lines 42-79) touch real source. A bug in the real branch order / missing `await` / wrong field would pass. Fix: drive the real functions (compile to JS or import via a runtime as `verify-vector-memory-write.mjs` does), keeping mocks only for env bindings.
12. **`package.json:13`** — major — the `verify` script does not include `node scripts/verify-dedup-gate.mjs`, so `npm run verify` never runs it (and still references the missing `verify-extract-pipeline.mjs`). Fix: add `&& node scripts/verify-dedup-gate.mjs` to `verify`.
13. **`scripts/verify-dedup-gate.mjs:262-264`** — minor — operator-precedence bug: `!env.DB.memories.get(...)?.status === "active"` parses as `(!….status) === "active"` (always false), so `decision_note: "target_gone_fallback"` is never emitted and the fallback-note path is untested even in the mock. Fix: `(env.DB.memories.get(...)?.status !== "active")` and assert on `decision_note`.
14. **`scripts/verify-dedup-gate.mjs:549-573`** — nit — the isolation-invariant test asserts a mock `mockSearchMemories` doesn't surface log-table content; it's tautological since the mock only reads `db.memories` and never touches the real `searchVectorMemories`. Fix: assert at the source level that `upsertMemoryEmbedding`/`searchVectorMemories` never read the log tables, or remove the tautology.
15. **`scripts/verify-assembler.mjs:288-303`** — minor — the `boot_stable` mock still renders `<yesterday_log>` from `ctx.boot.yesterday_log`, diverging from production `formatBootStable` which now emits `<impressions>`. Stale fixture. Fix: align the mock with the new `formatBootStable` ladder.

## Summary

- **Blocker:** #4 (monthly rollup deletes straggler weeks without folding — real data loss in normal operation).
- **Major:** #5 (dedup `version_status` filter is dead code + re-supersede loop on `deleteByIds` failure), #11 (verify script tests mocks, not real code), #12 (verify script not wired into `npm run verify`).
- **Minor:** #1, #6, #7, #8, #13, #15.
- **Nit:** #2, #3, #9, #10, #14.

Areas that are clean: A1/A2/B/C routing logic and return shapes; D1 migration (sequential, idempotent, matches spec field list); D3 ladder ordering and from-monthly-up truncation; fail-open semantics in `dedupGate` (genuine try/catch → null → create); cron ordering (weekly before monthly); admin endpoint shape; `不做的事` boundaries (no companion-hook / namespace / search-ranking / data-migration changes).
