# Spec: 写入查重闸 + fact_key 继承 + approve 路由 + 双分辨率印象注入

日期：2026-07-16。作者：旦九（spec/验收）。实现：grok。审查：glm。
分支：`feat/dedup-gate-dual-resolution`（基于 origin/main d76daac）。

## 背景（真实事故）

2026-07-15 夜批 review 管道为已有事实 `saki_tool_company_stance`（mem_42dc2294，06-29 建，source=dream）生成了内容几乎相同的候选（仅多一句飞书偏好），候选 fact_key=null，审批 approve 后走 `createMemory` 直接 insert，产生重复活跃记忆 mem_0a0db7ca。两条向量几乎重合，每次检索一起注入。

根因三层：
1. 去重唯一机制是 fact_key 精确匹配，而 fact_key 只靠 prompt 提示模型复用，无存储层兜底。
2. `dailyDigest.ts` 的 dream_update 候选硬编码 `factKey: null`（约 :927），目标记忆的 key 不继承。
3. `api/memories.ts` approve 动作（:769-807）无视 `candidate.target_memory_id`，一律 `createApprovedMemoryFromCandidate` → fact_key 为 null 时纯 insert。整条写入链没有任何向量相似度查重。

## 变更 A：向量相似度查重闸（dedup gate）

新增模块 `src/memory/dedupGate.ts`：

```ts
export interface SimilarHit {
  memory: MemoryApiRecord;   // 现有活跃记忆
  score: number;             // Vectorize cosine 相似度
}

export async function findSimilarActiveMemory(
  env: Env,
  input: { namespace: string; content: string; excludeIds?: string[] }
): Promise<SimilarHit | null>;
```

- 实现：复用 `searchVectorMemories(env, { namespace, query: content, topK: 5 })`，过滤 excludeIds 与非 active/superseded，取最高分。
- 阈值：`readNumber(env.DEDUP_COSINE, 0.9)`（该 env 已在 wrangler.toml [vars] 存在，值 "0.9"，当前无人使用——本变更让它生效）。分数 ≥ 阈值返回 hit，否则 null。
- 失败语义：embedding/Vectorize 异常时 fail-open（返回 null，写入照常，console.warn）。查重闸不能让写入链挂掉。

接入点两个：

**A1. 候选入队时（提示性，不拦截）** —— `createMemoryCandidate` 的调用方 `queueDreamExtractedMemories`（dailyDigest.ts）：入队前对 `memory.content` 跑 `findSimilarActiveMemory`。命中且候选没有 target_memory_id 时，把命中 id 写进 `targetMemoryId`，`decisionNote` 记 `dedup_gate: similar to <id> (score=<x.xx>)`。候选照常入队，人审时能看到建议。
   - 注意配额：一次夜批可能几十条候选，每条一次 embedding 调用可接受（bge-m3 便宜）；不做批量优化，但要串行 await 避免并发打爆 Workers AI。

**A2. 审批落库时（强制路由）** —— `createApprovedMemoryFromCandidate`（api/memories.ts:688-729）改造：
   1. `input.factKey` 存在 → 保持现状走 `upsertMemoryByFactKey`。
   2. 无 factKey → 先跑 `findSimilarActiveMemory`。命中 → 改走 `supersedeMemory({ oldId: hit.memory.id, newContent, ... , reason: "dedup_gate_supersede" })`（supersedeMemory 会自动继承旧行 fact_key，见 db/v2.ts:984-997）。
   3. 未命中 → 维持 `createMemory` + `syncMemoryEmbeddingBestEffort`。
   - 返回值需区分发生了什么：返回类型从 `Promise<string>` 改为 `Promise<{ id: string; action: "upserted" | "superseded" | "created"; supersededId?: string }>`，approve handler 把 action 放进响应 JSON 和 decision_note。

## 变更 B：dream_update 候选继承目标 fact_key

`dailyDigest.ts` applyDreamV2 中 dream_update 分支（约 :923-934）：
- 现状 `factKey: null` → 改为：读取 target 记忆的 fact_key（body 列优先，`memory_lifecycle` 侧车兜底——与 upsertMemoryByFactKey :793-804 相同的取法，可抽公共 helper `resolveMemoryFactKey(env, id)` 放 db/v2.ts），填进候选。
- target 不存在或无 fact_key 时保持 null，不造 key。

## 变更 C：approve 尊重 target_memory_id

`handleMemoryCandidates` approve 动作（api/memories.ts:769-807）：
- 在现有 dream_delete 特判之后新增：`candidate.target_memory_id` 存在，且该记忆存在、`status='active'`、非 superseded → 直接 `supersedeMemory({ oldId: target_memory_id, newContent: content, newFactKey: factKey /* 可为 null，supersede 自会继承 */ , source: "review", reason: "approve_update" })`，不进 `createApprovedMemoryFromCandidate`。
- target 已失效（被删/已 superseded）→ 回落到 A2 的查重闸路径，decision_note 注明 `target_gone_fallback`。
- 响应 JSON 带 `action` 字段（同 A2）。

## 变更 D：双分辨率印象注入（抄 tidal-memory 的架构）

设计原则（来自 0xblewalker/tidal-memory）：低分辨率"印象"走开场连续性通道，高分辨率精确记忆走检索通道，两条通道物理隔离；印象随时间逐级降解（日→周→月），源行归档不销毁。

Aelios 现状盘点：
- daily_log / weekly_log 已存在且**从不进 Vectorize**（隔离的一半天然成立，此为不变量，见下）。
- boot 包（`buildBootPackage`, memory/v2/recall.ts:170-191）只注入**昨天**一条 daily_log。
- weekly_log 从不注入上下文，只有 MCP diary_get 和控制台能看。
- 月级 rollup 不存在。

**D1. 新表 `monthly_log`** —— migration `migrations/0009_monthly_log.sql`，结构仿 weekly_log（0008）：PK (namespace, month)，month 格式 `YYYY-MM`，title, summary, source_week_count, created_at, updated_at。

**D2. `runMonthlyRollup`** —— 新文件 `src/memory/monthlyRollup.ts`，仿 weeklyRollup.ts：
- 输入：`weekly_log` 中 week 起始日期早于 35 天的行，按月分组（周归属月 = 该 ISO 周周四所在月，跨月周不重复计入）。
- 每组 ≥2 行才卷（孤儿周留在原地等下月）；LLM 写 2-3 句月度印象（模型 `DIARY_MODEL`||`DREAM_MODEL`，prompt 要求：宽泛主题+关系氛围，禁止精确数字/引语/工具名/私密细节——tidal 的 vague writer 契约）；upsert 进 monthly_log；删除已卷入的 weekly_log 行（与 weeklyRollup 删 daily_log 同模式）。
- 挂进现有 cron 链：weeklyRollup 之后调用；新增 `POST /admin/monthly-rollup` 管理端点（仿 /admin/weekly-rollup，index.ts:249-258）。

**D3. boot 印象梯** —— `buildBootPackage` 扩展：`[Impressions]` 段 = 昨天 daily_log（现状保留）+ 最近 1 条 weekly_log + 最近 1 条 monthly_log，按 daily→weekly→monthly 顺序拼接，总预算 `IMPRESSION_LADDER_MAX_CHARS`（env，默认 1000）超出从月级往上截。渲染进 `bootStableBlock`（assembler/blocks.ts:282-292）对应格式化函数 `formatBootStable`。boot 包是稳定前缀，注意不要引入时间戳等破坏 prompt cache 的易变内容（月/周标签本身变化频率低，可接受）。

**D4. 隔离不变量显式化** —— daily_log / weekly_log / monthly_log 永不 embed、永不进 `/v1/memory/search` 与 `runRecall` 结果。在 `embedding.ts` 的 `upsertMemoryEmbedding` 入口加注释声明不变量；在 verify 脚本（见验收）里断言三张表的内容不出现在 search 结果中。

## 不做的事（划界）

- 不动 companion hook（阅后即焚/cooldown 另案，她自己在做）。
- 不做 namespace 相关逻辑扩展（单用户，默认 namespace）。
- 不迁移/清洗现存重复数据（mem_42dc2294/mem_0a0db7ca 那对由旦九验收后手工处理）。
- 不改 `/v1/memory/search` 的排序/过滤逻辑。
- 不新增测试框架；沿用 scripts/verify-*.mjs 模式 + typecheck。

## 验收标准（旦九执行）

1. `npm run typecheck` 通过；`npm run verify` 通过（注意：package.json 里引用的 verify-extract-pipeline.mjs 在 git 里缺失，若 verify 因此本来就红，以 typecheck + 新增脚本为准并在交付报告里说明）。
2. 新增 `scripts/verify-dedup-gate.mjs`：模拟 env（mock AI.run/VECTORIZE 与 D1，参考 verify-vector-memory-write.mjs 的 mock 手法）驱动：
   - a. 无 factKey + 高相似命中 → 走 supersede，旧行 version_status=superseded，新行继承 fact_key；
   - b. 无 factKey + 无命中 → createMemory；
   - c. 有 factKey → upsertMemoryByFactKey（现状不回归）；
   - d. approve 带活跃 target_memory_id → supersede 该 target；target 已 superseded → 回落查重闸；
   - e. embedding 抛错 → fail-open 走 createMemory。
3. dream_update 候选生成后查库：fact_key 等于 target 的 fact_key。
4. migration 0009 在本地 D1（`npm run db:migrate:local`）跑通且幂等。
5. monthlyRollup：本地灌入 3 条 35 天前的 weekly_log（同月 2 条 + 异月孤儿 1 条）→ 跑 rollup → monthly_log 出现 1 行、该月 2 条 weekly 被删、孤儿保留。
6. boot 包输出包含三级印象且尊重字符预算（手动构造数据验证）。
7. 全链人工验收：wrangler dev（acceptance 配置 wrangler.acceptance.toml）起本地实例，走一遍 候选→approve 的 HTTP 流程确认 action 字段与 supersede 行为。

## 实现注意

- 风格跟随仓库现状：无框架裸 TS、readString/readNumber 工具函数复用、console.warn 打日志不打私密内容（只打 id/score/reason）。
- `supersedeMemory` 已处理向量删旧插新与 relation 边，不要重复实现。
- D1 侧车表 `memory_lifecycle` 与 memories 主表的 fact_key 双写现状保持，helper 读取时 body 优先侧车兜底。
- 提交拆分建议：A（闸模块+两个接入点）/ B+C（fact_key 继承与 approve 路由，一个语义组）/ D（migration+monthlyRollup+boot 梯）三个 commit，便于回滚。
- 禁止：push 到任何远端、改 wrangler.toml 的 Production 相关配置、动 .secrets。
