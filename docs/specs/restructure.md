# Spec: restructure — 三大文件拆分（2026-07-16）

目标：把三个巨型文件拆成按领域组织的小模块，**纯搬家，零行为变化**。
分支：`feat/restructure`（基于 feat/fix-pack）。

## 铁律

- 只允许移动代码和调整 import/export，不允许改任何函数体、SQL、模板字符串内容。
- 发现搬家过程中"顺手想修"的东西：不修，在 PR 说明里列出来。
- 不新增依赖。不改 wrangler.toml。不 push。
- 每个部分一个独立 commit（共 3 个），前缀 `refactor:`。

## 验收总门槛

1. `npm run typecheck` 全绿。
2. `npm run verify` 全绿。
3. 部分 B 的 HTML 字节级一致校验通过（见下）。
4. 拆分后单个新模块原则上不超过 600 行。

---

## 部分 A — src/db/v2.ts（2056 行）按领域拆分

新目录 `src/db/v2/`，按现有代码的领域边界切：

- `digest.ts` — DigestRow / getDigest / upsertDigest
- `precious.ts` — PreciousRow / create / getById / list / delete / markPreciousInjected
- `glossary.ts` — GlossaryRow / upsert / list / update / delete / matchGlossary
- `longtail.ts` — LongtailRow / create / list / fetchByIds / delete
- `memories.ts` — 记忆生命周期：MemoryV2Patch、fetchMemoryLifecycleRows、upsertMemoryByFactKey、resolveMemoryFactKey、getActiveMemoryByFactKey、markMemorySeen、supersedeMemory、markMemoriesUnderReview、archiveMemory、deleteMemoryV2、markMemoriesInjected、listActiveMemories、countActiveMemoriesByType、countActiveMemoriesOfType、listActiveFactKeys
- `candidates.ts` — MemoryCandidateRow / create / list / count / getById / updateStatus
- `logs.ts` — DailyLogRow 及 daily/weekly/monthly log 相关（1304 行之后的部分，按实际内容归置）
- `relations.ts` — MEMORY_REL_TYPES / isMemoryRelType / defaultRelationWeight
- 文件内私有 helper 跟随使用它的领域走；被多个领域共用的放 `shared.ts`

`src/db/v2.ts` 原文件改成纯 barrel：`export * from "./v2/xxx"` 逐个转发，**保持每一个现有 export（含 type/interface）可从原路径导入**。全库其它文件的 import 语句一律不动。

## 部分 B — src/api/admin.ts（2200 行）UI 与 handler 分离

结构现状：约 1-2067 行是 `memoryAdmin()` 巨型 HTML/Alpine 模板及其辅助，2068 行起是 handleAdmin / handleDiaryAdmin / handleDiaryRewriteAdmin / handleWeeklyRollupAdmin / handleMonthlyRollupAdmin 五个 handler。

拆法：
- 新目录 `src/api/admin/`，模板部分挪到 `src/api/admin/ui.ts`（如模板内部有清晰的分段结构——多个面板/多个 `<div x-show>` 区块——可以进一步按面板拆成多个文件再拼接，但**拼接结果必须与原字符串完全一致**；若模板是难以安全切分的整体，就整体挪进 ui.ts，不硬拆）。
- 五个 handler 挪到 `src/api/admin/handlers.ts`。
- 原 `src/api/admin.ts` 改 barrel 转发，路由注册处（index.ts 等）import 不动。

字节级一致校验（先写校验、后动手拆）：
1. 拆之前，先写临时脚本把 `handleAdmin()` 返回的 HTML 文本 sha256 存到 `/tmp/admin-html-before.txt`。
2. 拆完后重跑，比对哈希一致。
3. 校验脚本不入库，PR 说明里附上前后哈希值。

## 部分 C — src/memory/dailyDigest.ts（1537 行）抽工具层

- 时区/日期工具（formatDate、parseDateLabel、getTimeZoneOffsetMs、zonedWallTimeToUtc、addDaysToDateLabel、getDateRangeForLabel、getTargetDigestDateLabel、getDateLabelsLookback、readDailyCursor）挪到 `src/memory/dreamDates.ts`。
- env 读取器（isDreamEnabled、readDreamStrategy、readDreamModel、readDreamTimeZone、readDreamMaxMessages、readDreamMaxTokens、readDreamMemoryContextLimit、readFirstEnvValue 及同类）挪到 `src/memory/dreamEnv.ts`。
- 通用小工具（readPositiveInt、clampScore、readString、readStringArray、truncate、extractJsonObject 等）：先 grep 全库看 utils/ 下是否已有同名等价实现，有就复用（前提是行为完全一致，逐字符比对函数体），没有就挪到 `src/memory/dreamUtils.ts`。行为有任何差异的不合并，原样搬走。
- normalize/transcript/路由计划等 digest 主流程留在 dailyDigest.ts。
- weeklyRollup / monthlyRollup / dreamExtract 等兄弟文件若 import 了 dailyDigest 的导出，改从新模块 import；对外导出面保持不变。

## 明确不做

- 不拆 memories.ts（1087 行）、mcp.ts（794 行）等其它文件，本次只动三个目标。
- 不做条目 10（contentToText 合一）——那是行为裁定问题，不属于纯搬家。
- 不改任何函数实现、不加类型注解、不改注释内容（挪动时注释跟着代码走）。
