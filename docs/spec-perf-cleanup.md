# Spec: perf-cleanup（去重 + 并行化 + 边缘缓存搭头）

分支：`feat/perf-cleanup`（已建，基于 main@60e3536）。
只做下面五项，不做其他"顺手优化"。明确禁止事项见文末。

## 1. sanitizeMemoryContent / contentToText 去重

现状：`sanitizeMemoryContent` 在 `src/memory/inject.ts:24`、`src/memory/extract.ts:28`、`src/assembler/blocks.ts:48`、`src/memory/filter.ts:72` 各有一份定义。前三份完全一致；**filter.ts 那份是超集**，比基础版多四条前置规则（`<time_reminder>`、`对话摘要（N 条消息）：`、`用户话题：`、`助手要点：` 的清洗）。
`contentToText` 在 `src/memory/inject.ts:3` 和 `src/assembler/blocks.ts:34` 重复。

要求：
- 新建 `src/utils/sanitize.ts`，导出：
  - `sanitizeMemoryContent(text: string): string` — 基础版，正则逐条照抄现有实现，顺序不变。
  - `sanitizeSummaryContent(text: string): string` — 先跑 filter.ts 独有的四条前置规则，再调基础版。
  - `contentToText(content: OpenAIChatMessage["content"]): string` — 若两份实现有差异，以行为并集为准并在注释里说明；一致就直接搬。
- 四个文件删掉本地定义改为 import；filter.ts 改用 `sanitizeSummaryContent`。
- **行为必须逐字节一致**：对同一输入，新函数输出必须与原各文件旧函数完全相同。

## 2. chatCompletions 的 boot 与 recall 并行

现状：`src/api/chatCompletions.ts:116-117` 串行 `await buildBootPackage` → `await runRecall`，且 runRecall 没传 `core_fingerprint`，导致 recall 内部走 `buildCoreFingerprintFromDb` 又查一次 precious 表。

要求：
- 改为 `Promise.all([buildBootPackage(...), runRecall(...)])` 并行。
- **不传 core_fingerprint**（传了就得等 boot，回到串行）。recall 内部的 DB 兜底指纹与 boot 指纹同源（都是 precious 表），语义等价，多这一次小查询换整个 boot 的延迟被 recall 遮住，是净赚。在调用处加一行注释说明这是有意的取舍。
- `src/api/mcp.ts` 的 `memory_recall` 工具不改（它没有 boot 在手，走 DB 兜底是对的）。

## 3. buildBootPackage 内部读并行

现状：`src/memory/v2/recall.ts:156` 起，七次 await 全串行。

要求：
- 六个独立读用 `Promise.all` 并发：`listPrecious`、`listAllGlossary`、`getDailyLog`、`listRecentWeeklyLogs`、`listRecentMonthlyLogs`、`loadSpontaneousForBoot`。
- `loadSpontaneousForBoot` 现有 try/catch 降级语义必须保留（失败不拖垮整个 boot，只 warn + 空数组）——包一层或用 `.catch()`。
- `markPreciousInjected` 依赖 precious 结果，保持在 Promise.all 之后串行执行，不许并进去。
- 返回值的字段内容、排序（precious 按 created_at 升序）不变。

## 4. searchMemoriesWithProvenance 合并 lifecycle 查询

现状：`src/memory/search.ts` 先 `fetchMemoriesByIds`（:308），过滤出 activeRecords，`markMemoriesRecalled`（:393 附近）之后再 `fetchMemoryLifecycleRows`（:398）。两次 D1 round-trip，第二次的 id 是过滤后的子集。

要求：
- 在 `src/db/`（memories.ts 或 v2.ts，看归属）新增 `fetchMemoriesWithLifecycleByIds`：一条 SQL，memories LEFT JOIN memory_lifecycle ON memory_id，按 namespace + id 列表取，返回 memory 行 + 可空的 lifecycle 侧车字段。
- `searchMemoriesWithProvenance` 改用它一次拿完，删掉后面那次 `fetchMemoryLifecycleRows` 调用。
- **不要改动现有 `fetchMemoriesByIds` 的签名或行为**，其他调用方不受影响。
- `markMemoriesRecalled` 的位置和语义不变。
- lifecycle 行缺失时行为同现在（map 里查不到 → null）。

## 5. Workers Cache 搭头（仅两个无害端点）

Cloudflare 2026-07-06 发布的 Workers Cache（wrangler 配置 `[cache] enabled = true`，命中不进 Worker，靠标准 Cache-Control 头控制）。

要求：
- `GET /health` 响应加 `Cache-Control: public, max-age=30`。
- `GET /v1/models` 响应加 `Cache-Control: public, max-age=300`。
- wrangler.toml 加 `[cache]\nenabled = true`，带注释说明只有上面两个端点发了缓存头。
- **明确禁止**给 `/v1/memory_boot`、`/admin`、或任何带鉴权/按 namespace 出数据的端点加缓存头：boot 是 Bearer token 按用户出记忆的，边缘缓存有跨用户泄漏风险，且 boot 每次要写 markPreciousInjected 记账，缓存命中会断账。

## 验收标准

- `npm run typecheck` 通过。
- `npm run verify` 通过（verify-assembler / verify-vector-memory-write / verify-dedup-gate 三个脚本）。
- 第 1 项写一个小验证脚本（scripts/ 下，或临时跑完即删）：拿 10 条含各种标记的样例文本，断言新 sanitize 函数与旧实现输出一致（旧实现可临时内联在脚本里对照）。
- 每项一个 commit，commit message 前缀 `perf:` 或 `refactor:`，中文一句话说明。

## 禁止事项

- 不许动 cron（index.ts scheduled handler）的执行顺序——dream→diaryWriter 有 cursor 依赖，weeklyRollup→monthlyRollup 有数据依赖，串行是设计。
- 不许给 boot 包加任何缓存层（HTTP 边缘缓存、KV、caches.default 都不行）。
- 不许加 embedding 缓存。
- 不许 push、不许碰 main、不许改 wrangler.toml 里缓存以外的配置。
- 不许改 anthropicAdapter 的断点预算逻辑。
