# v3-slim 修复单（旦九终审 + 对抗审 findings，2026-07-06）

在 `feat/v3-slim` 分支上继续施工。审查判定 FIX-FIRST，以下按严重度排列。修完全部跑一遍原验收清单（tsc / verify-cache-strategy / verify-assembler）再交。

## F1 · BLOCKER：workers-ai 聊天模型没有原生分支，零配置是假的

`src/proxy/openaiAdapter.ts` 的 `callOpenAICompat` 无条件走 `normalizeAiGatewayBaseUrl`，未配 `AI_GATEWAY_BASE_URL` 直接 throw。而 v3 默认 `DREAM_MODEL=workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`，dream（`callDigestModel`）与 dreamExtract 都经它调用——零配置部署下每晚 dream 必炸，raw 消息保留期一过当天事实永久丢失。README 路由表早就声称 `workers-ai/@cf/... → env.AI.run（不走 AI Gateway）`，但只有 embeddings 和 filter 实现了。

**修法**：在 `callOpenAICompat`（或其入口处）加 workers-ai 原生分支：`body.model` 以 `workers-ai/` 开头时，剥前缀调 `env.AI.run(model, { messages, ... })`，把结果包装成 OpenAI chat completions 形状的 Response 返回（参考 embedding/filter 现有 AI.run 用法）。不碰 AI Gateway 路径的现有行为。
**验收**：本地模拟 env 无 `AI_GATEWAY_BASE_URL` 时，`callDigestModel` 的 workers-ai 默认模型路径不 throw；配了 gateway 的老路径行为不变。

## F2 · MAJOR：memories_to_add 被静默丢弃，dry_run 撒谎

`buildDreamRoutingPlan` 把每条 `digest.memories_to_add` 报告为 `destination: "candidate"`，但 `applyDreamV2` 完全没处理 `memories_to_add`——不入队也不落库。模型就算被提示"默认给空数组"也可能给出内容，计划和执行必须一致。

**修法**：`applyDreamV2` 里把 `digest.memories_to_add` 逐条 `createMemoryCandidate`（source=`dream_add`，逐条 try/catch 与其他同款）。
**验收**：构造含 memories_to_add 的 digest，dry_run 计划与实跑入队数一致。

## F3 · MAJOR：抽取失败被吞，当天不可恢复

`extractDreamMemoriesFromMessages` 失败返回 `{memories: [], reason: "model_error"}`，`runDailyMemoryDigest` 只读 `.memories` 不看 `.reason`——digest 成功而 extract 失败时 run 记 `status: ok`、游标推进，零候选入队且永不重试。A2 之后这是唯一首写路径，等于静默丢一天。

**修法**：
1. `.reason` 为 model_error 时，本次 run 记 error（进 `dream_runs.errors`），游标**不推进**，让现有重试/backfill 机制接住。
2. 抽取调用移到 `!digest` 检查之后，digest 失败时不再白烧一次抽取调用。
**验收**：模拟 extract 模型失败 → run status=error、游标不动；下次 run 重试补上。

## F4 · MINOR 打包（全部要修，但都小）

1. **legacy 尾巴**：`dailyDigest.ts:1487-1512` 的 legacy 直写（memories_to_add 直接 `createVectorMemory`、`saveImportantExcerpts` 直写）按 spec A2 本应删除，现在还在（`DREAM_STRATEGY=legacy` 或关 lifecycle 可达）。删掉这两段直写及 `saveImportantExcerpts` 本体；legacy 策略如因此名存实亡，连 `"legacy"` 分支一起删，`readDreamStrategy` 收窄。
2. **maintenance.ts 旁路**：`runMemoryMaintenance` 里从 merge.ts 搬来的抽取直写路径（`createVectorMemory` / `upsertMemoryByFactKey`），一个 env 开关（`ENABLE_INCREMENTAL_MEMORY`）之遥就是队列旁路。删除该直写路径及对应 env。
3. **dream_delete 死胡同**：审核端点 approve 一条 source=`dream_delete` 的候选时，现在会把待删记忆的内容重新建成一条新记忆（复活死者）。修法：approve 处理时如 `source==="dream_delete"` 且带 `targetMemoryId` → 归档/软删目标记忆，不创建新记忆。
4. **review 策略丢抽取**：`DREAM_STRATEGY=review` 提前 return，抽取产物既不入队也不进 proposal，游标却推进。修法：review 分支同样先 `queueDreamExtractedMemories` 再走 proposal。
5. **死代码**：`dailyDigest.ts` 未用的 `createLongtail` / `upsertLongtailEmbedding` import、`shouldArchiveDreamDeletesToLongtail`；补回 `index.ts` / `maintenance.ts` / `filter.ts` 的文件尾换行。
6. **MCP 一致性**：`memory_extract_dryrun` 加与 digest_get 同款的废弃报错 shim（而不是 Unknown tool）；MCP `diary_get` 的 date 参数补 `^\d{4}-\d{2}-\d{2}$` 校验，与 REST 对齐。

## 交付

- 所有修复 commit 在 `feat/v3-slim`，信息清楚，不 push。
- 结尾汇报：每条 F 的修法落点（file:line）、三个验收命令的实际输出、有无偏离。
