# Spec: fix-pack — 审查修理包（2026-07-16）

外部审查发现 + 旦九逐条验证后的修理清单。全部为小改动，**不做结构性拆分**（拆大文件是下一个分支的事）。

分支：`feat/fix-pack`（基于 main @ 1c45026）。
实现者按条目顺序做，**每个条目一个独立 commit**，commit message 用 `fix:`/`docs:`/`chore:` 前缀 + 条目编号。

## 验收总门槛

- `npm run typecheck` 全绿。
- `npm run verify` 全绿（含 verify-assembler / verify-vector-memory-write / verify-dedup-gate / verify-sanitize 四个脚本）。
- 除条目 2 外，所有改动不得改变任何对外行为。

---

## 条目 1 — apiKey 时序安全比较

`src/auth/apiKey.ts`：五处 `token === env.XXX_API_KEY` 改为时序安全比较。

实现要求：
- 写一个本地 helper `timingSafeEqualStr(a: string, b: string): boolean`：用 `TextEncoder` 编码，**长度不同直接返回 false 之前，仍要对等长数据做一次 `crypto.subtle.timingSafeEqual` 以避免早退**（可用 a 与 a 自比较后 return false 的惯用法）；等长时用 `crypto.subtle.timingSafeEqual`。
- 五个 key 的判断逻辑、返回的角色/scope 不变。

## 条目 2 — messages 保留期 3 天 → 可配置，默认 7 天

`src/memory/retention.ts`：`MESSAGES_RETENTION_DAYS = 3` 改为从 `env.MESSAGES_RETENTION_DAYS` 读取，默认 **7**。

实现要求：
- 解析用与现有 env 数字解析一致的方式（参考 filter.ts / recall.ts 里现有的 readPositiveInt 类工具，不要新发明）。
- `src/types.ts` 的 Env 增加可选字段 `MESSAGES_RETENTION_DAYS?: string`。
- `wrangler.toml` `[vars]` 增加 `MESSAGES_RETENTION_DAYS = "7"`，带一行注释说明。
- README 中「messages: 14 天删」（约 338 行）改为 7 天，并注明可用 `MESSAGES_RETENTION_DAYS` 配置。

## 条目 3 — deleteVectorMemory 去掉墓碑 upsert

`src/memory/vectorStore.ts` `deleteVectorMemory`：删除整段「createEmbedding + upsert status:deleted 墓碑」逻辑，保留 `markMemoryRecordDeleted`（D1 标记）和 `deleteByIds`（向量删除）。

背景（写进 commit message）：墓碑原本是 deleteByIds 失败时的兜底，但召回链路开着 `RECALL_REQUIRE_D1_BACKING`，孤儿向量会被 D1 背书检查丢弃，双保险多余，且每次删除白算一次 embedding。

## 条目 4 — matchGlossary 下推到 D1

`src/db/v2.ts` `matchGlossary`：现在是 `listGlossary` 全量拉回后在 JS 里逐条子串匹配。改为单条 SQL 下推：`WHERE instr(?1, term) > 0`（?1 为查询文本），namespace 条件与现有一致，保留现有的命中数量上限与排序语义。

实现要求：
- 返回结构、字段、大小写敏感性与现状完全一致（现状是什么就保持什么，先读懂再改）。
- `listGlossary` / `listAllGlossary`（boot 用）**不动**。

## 条目 5 — precious 每轮聊天只查一次

现状：`src/memory/v2/recall.ts` 内 boot 路径 `listPrecious(limit 20)`（约 168 行），recall 指纹兜底 `buildCoreFingerprintFromDb` 再查 `listPrecious(limit 50)`（约 230 行）。chatCompletions 并行调 boot 与 recall，每轮聊天查两次 precious 表。

目标约束（实现方式可自选，但必须满足全部）：
1. 一次 chatCompletions 请求内 `listPrecious` 只执行一次（limit 50）。
2. boot 包内容不变（仍然只用前 20 条，字段与顺序不变）。
3. 指纹仍基于最多 50 条构建，语义与 `buildCoreFingerprintFromDb` 现状一致。
4. boot 与 recall 的并行执行不得退化为串行。
5. recall 单独被调用（不经 chatCompletions，例如 MCP 直接调）时行为不变：没人传指纹就走 `buildCoreFingerprintFromDb` 兜底。

建议实现：chatCompletions 先 `listPrecious(50)` 一次，把行喂给 boot（取前 20）与指纹构建（50 条），再把 `core_fingerprint` 传给 recall；同时删掉 chatCompletions.ts 116 行「故意不传」的注释。

## 条目 6 — README 模型默认值更新

README 环境变量表（约 369-370 行）：
- `DREAM_MODEL` 默认值改为 `workers-ai/@cf/openai/gpt-oss-120b`。
- `VISION_MODEL` 默认值改为 `workers-ai/@cf/google/gemma-4-26b-a4b-it`。

同时 grep README 全文，其它提及这两个旧模型名的地方一并更新。

## 条目 7 — README 删掉 DREAM_EXCERPT_LIMIT

README 约 392 行 `DREAM_EXCERPT_LIMIT` 一行：代码里不存在该变量，整行删除。

## 条目 8 — 清理 FORCE_ANTHROPIC_NATIVE 与 MEMORY_MIN_IMPORTANCE

两个变量文档有、类型有、代码无使用点：
- `src/types.ts`：删掉 `FORCE_ANTHROPIC_NATIVE?`（约 115 行）与 `MEMORY_MIN_IMPORTANCE?`（约 97 行）两个字段。
- README：删掉对应表行（约 386、410 行）及正文提及。
- 改前先 `grep -rn` 双重确认 src/ 与 scripts/ 下确无使用点；scripts 下若有使用则该变量保留并在 PR 说明里注明。

## 条目 9 — 删除 maintenance 死代码

- 删除 `src/memory/maintenance.ts`（`runMemoryMaintenance` 恒返回 `{ processed: false }`）。
- `src/queue/consumer.ts`：删掉 import 与 `case "memory_maintenance"` 分支（保留其它 case；若删除后 switch 需要 default 处理未知类型，打一行 console.warn）。
- `src/queue/producer.ts`：删除 `enqueueMemoryMaintenanceIfNeeded` 及其调用点（grep 全库找调用方一起清）。
- `src/types.ts`：删掉 `memory_maintenance` 消息类型定义（约 122 行），QueueMessage 联合类型同步收窄。
- 注意：`src/index.ts` 里 "scheduled memory maintenance" 日志属于 cron 调度路径，与本条目无关，**不要动**。admin.ts 里的 maintenance 面板文案也不动。

## 条目 10 — contentToText 四份副本合一

保留 `src/utils/sanitize.ts` 的 `contentToText` 为唯一实现，删除三份本地副本并改为 import：
- `src/assembler/toOpenAI.ts`（约 34 行，签名是 `string | unknown[] | null`，比主版本宽）
- `src/proxy/anthropicAdapter.ts`（约 72 行）
- `src/db/messages.ts`（约 6 行）

实现要求：
- 若 toOpenAI 的调用点类型比 `OpenAIChatMessage["content"]` 宽，允许把 sanitize.ts 主版本的参数类型放宽为兼容的联合类型（保持运行时行为不变），不允许在调用点用 `as any` 蒙混。
- 删副本前 diff 三份副本与主版本的运行时行为，若发现真实行为差异（不只是类型差异），停下来在 PR 说明里报告，不要擅自统一。

## 条目 11 — embedding.ts 去掉 as any

`src/memory/embedding.ts` 约 56 行 `env.AI.run(workersAiModelName as any, ...)`：改用 `@cloudflare/workers-types` 里的正确类型（如 `keyof AiModels` 断言或泛型参数），消除 `as any`。若 workers-types 版本对动态模型名确实没有可用类型，允许收窄为 `as keyof AiModels`，并加一行注释说明原因。

---

## 明确不做（out of scope）

- 拆 admin.ts / db/v2.ts / dailyDigest.ts（下一个分支 feat/restructure）。
- Agents SDK、AI Search 相关任何改动。
- 不新增依赖，不升级依赖版本。
- 不动 wrangler.toml 里与条目 2 无关的任何变量。
- 不 push，不 deploy。commit 停在本地，等审查与验收。
