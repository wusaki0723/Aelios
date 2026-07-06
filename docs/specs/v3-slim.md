# v3-slim 施工单（旦九 spec，2026-07-06；咲咲已全部拍板）

基于 `memory-v2` 分支施工，新分支 `feat/v3-slim`。一句话目标：Aelios 只做三件事——仓库、按需召回、夜间秘书。白天的智能归 agent 和客户端 system prompt。

**只 commit 到分支，不 push、不部署。** 终审后由旦九合并。

## 设计裁定（不可更改的前提）

1. 写入按信任来源分流：agent 经 MCP/REST 直写（upsert）→ 直接落库；dream 夜间抽取产物 → **全部进 candidates 审核队列，一条都不直接落库**，无论置信度。
2. 召回链只砍 per-turn 压缩模型，**reranker 保留**。
3. L1 digest 全线移除，persona 归客户端管理。
4. 日记（daily_log）升格为一等公民端点，agent 自己 fetch，**永不自动注入**。
5. 零配置默认：DREAM_MODEL 默认改 Workers AI 70B，整条默认链路不需要 AI Gateway。
6. 缓存以 v1 命中表现为基准：现有 fix/cache-prefix 的组装纪律（稳定前缀 + 末端易变）不得破坏，`verify-cache-strategy.mjs` 全绿是合并门。

## Phase A · 写入路径

### A1 删 4h 抽取
- `wrangler.toml`：crons 删 `"0 */4 * * *"`，保留 dream 的 `"10 20 * * *"`。
- `src/index.ts` scheduled 分支里对应的 extract 调度删除。
- 删 `src/memory/extractPipeline.ts` 及全部引用；`scripts/verify-extract-pipeline.mjs`、`scripts/eval-extract.mjs` 一并删除。
- env：`EXTRACT_MODEL`、`EXTRACT_REVIEW_CONFIDENCE` 从 types.ts / README / wrangler.toml 注释中移除。

### A2 dream 收编每日抽取（产物全待审）
- dream 管线（`src/memory/dailyDigest.ts` + `src/db/v2.ts` 的 applyDreamV2 一带）新增一步：从当天 raw messages 抽稳定事实（带 fact_key 与 type），**产物全部写入 candidates 表（status=pending）**，绝不直接 upsert 进 memories。复用现有 candidates 表结构与 4 个审核端点，不改它们。
- dream 保留：daily_log 生成（title+summary 写 `daily_log` 表）、world_fact supersede、重要原文摘录。
- dream 移除：L1 摘要重写、memories_to_add 直接落库路径。merge/update/delete 建议同样只落 candidates（用现有 merge/supersede 审核动作承接）。
- 删 `src/memory/merge.ts` 及引用。
- 保持 07-06 刚修的纪律：逐条 try/catch、supersede 幂等、守卫以 D1 为准、dream_runs 观测不动。

### A3 零配置默认
- `DREAM_MODEL` 默认值改为 `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`（config/types 默认值 + README env 表）。
- `MEMORY_FILTER_MODEL` 整个移除（见 B1）。
- 验证默认路径（不配 AI Gateway、不配第三方 key）下 dream dry_run 能跑通 Workers AI 分支。

## Phase B · 读取路径

### B1 召回链砍压缩、保 reranker
- `src/memory/filter.ts`：删 per-turn 压缩模型调用（MEMORY_FILTER_MODEL 相关全部代码路径）；reranker（`MEMORY_RERANKER_MODEL` / `ENABLE_MEMORY_RERANKER`）原样保留。
- 召回产物改为记忆原文直出（去重、分数地板照旧）；`/v1/search/memories` 的 `include_prompt` 返回原文拼接。
- 代理模式自动注入保留，默认 k=3、`min_score=0.15`。
- README「Workers AI 额度风险」一节重写：压缩模型已移除，默认链路只剩 embedding + reranker + dream（每日一次），额度大头消失。

### B2 L1 digest 全线移除
- REST：`PATCH /v1/memory_boot` 的 digest 写入（memories.ts:381 一带）删除；`memory_boot` 返回包去掉 `digest` 与 `longtail` 字段，保留 dailyLog / precious / glossary（全量）/ todayMessages / 统计。
- MCP（`src/api/mcp.ts`）：`digest_get` / `digest_set` 移除——参照 `memory_create` 的做法，调用时报错提示已废弃（digest 归客户端 system prompt；日记用 diary 工具）。
- dream 不再写 digest（A2 已含）。
- admin 面板（`src/api/admin.ts`）：删「L1 摘要」卡片/编辑入口；**审核队列 tab 保留不动**。
- longtail 收容逻辑随 L1 一起移除。
- D1 里已有的 digest 数据不迁移不删除，表结构不动（只是没人读写了）。

### B3 diary 一等公民端点
- 新增 `GET /v1/diary?date=YYYY-MM-DD`：读 `daily_log` 表单日记录；无记录返回 404 风格的空 data。
- 新增 `GET /v1/diary/recent`：默认返回今日+昨日两条（存在几条给几条）。
- 新增 MCP 工具 `diary_get`（参数 date 可选，缺省=recent 行为）。
- 鉴权与其他 /v1 端点一致（memory:read scope）。
- **这两个端点的内容不进任何自动注入路径**——assembler 不碰它。

### B4 README 对齐
- AI 版：管线三段（注入/抽取/整理）重写为 v3 形态；REST 端点表、MCP 工具表、env 速查表同步。
- 人类版：三步部署文案强调零配置——「不配任何模型 key 也能用」。

## 验收清单（全过才算完）

1. `npx tsc --noEmit` 干净。
2. `node scripts/verify-cache-strategy.mjs` 全绿（含断点 ≤4）。
3. `node scripts/verify-assembler.mjs` 通过（如受 boot 包字段变化影响，同步修 fixture 而不是删断言）。
4. wrangler.toml 只剩一条 cron。
5. 代码库中 grep 不到 `extractPipeline`、`MEMORY_FILTER_MODEL`、`digest_set`（除废弃报错文案与 CHANGELOG/README 历史说明）。
6. dream dry_run（`POST /v1/dream/run` dry_run=true）返回的计划中：新记忆全部标记为 candidates 去向，无直接 upsert。
7. `GET /v1/diary/recent` 与 `GET /v1/diary?date=` 返回 daily_log 内容。
8. MCP tools/list 中无 digest_get/digest_set，有 diary_get；digest_set 调用返回明确废弃错误。
9. 一次 commit 序列在 `feat/v3-slim`，信息清楚，不 push。
