# 迁移指南：从旧 Vectorize-only 记忆库迁移到 D1-canonical 架构

**本指南仅适用于已有记忆库的老用户。** 全新安装的用户无需执行任何迁移步骤——数据库 migration 是纯加列操作，不需要 import 或 backfill。

---

## 背景

在 `lmc5-xyzem-memory` 分支之前，Aelios 的记忆只存在 Vectorize 里（metadata 包含完整 content），D1 的 memories 表是空的。

本分支把架构改成了 **D1-canonical**：D1 是记忆的唯一真相源，Vectorize 只存 embedding + ref_id + 最小元数据。

如果直接切换到新分支而不做迁移，D1 是空的，现有记忆会全部从召回中消失。

---

## 迁移步骤（按顺序）

### 1. 应用数据库迁移

```bash
npm run db:migrate:remote
```

这会执行 0003（XYZEM 坐标列）和 0004（audit_state / vector_sync_status 列）migration。纯加列，不影响现有数据。

### 2. 导入 Vectorize 记忆到 D1（关键步骤）

```bash
# 先 dry-run 看计划
node scripts/import-vectorize-to-d1.mjs

# 确认计划无误后，实际导入（自动先备份 D1）
node scripts/import-vectorize-to-d1.mjs --apply
```

**必须在 backfill 之前跑。** 脚本会把 Vectorize 中所有记忆的 content、type、importance 等字段读出来，写入 D1 canonical 行。幂等——已存在的 id 会跳过，可断点续跑。

所需环境变量：
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `VECTORIZE_INDEX_NAME`（默认 `memo-kb`）
- `D1_DATABASE_NAME`（默认 `companion_memory_proxy`）

### 3. 补全 XYZEM 坐标（可选，建议 dry-run 先审）

```bash
# dry-run
node scripts/backfill-xyzem-memories.mjs

# 确认后再 apply
node scripts/backfill-xyzem-memories.mjs --apply
```

backfill 会调 LLM 为每条记忆生成 fact_key、thread、risk_level 等坐标。建议先 dry-run 看输出质量。

### 4. 重建 Vectorize 嵌入（可选）

```bash
node scripts/reindex-vectorize.mjs --api-url https://<worker> --api-key <KEY>
```

如果第 2 步导入时已经设了 `vector_sync_status = "synced"`，这步可以跳过。但如果想确保所有向量都用新的最小 metadata 格式，可以跑一次。

**reindex 有防呆：** 如果 D1 active 记忆数为 0（说明导入还没跑），reindex 会拒绝执行。需要 `--force` 才能覆盖。

### 5. 检查 review 队列

迁移后可能有 fact_key 冲突或需要人工审核的事件：

```bash
curl "https://<worker>/v1/debug/review_events?limit=50" \
  -H "Authorization: Bearer <DEBUG_API_KEY>"
```

---

## 迁移期间禁止操作

**不要跑以下清理脚本：** 它们会删数据，跟迁移无关。

- `npm run vectorize:clean` — 会删 Vectorize 向量
- `npm run vectorize:clean:llm` — 会调 LLM 判断并删向量
- `npm run memory:deep-clean` — 会硬删 D1 记忆

---

## 回滚

如果迁移出问题，`--apply` 模式会在 `backups/` 目录生成 D1 SQL 导出备份。可以用它恢复：

```bash
npx wrangler d1 execute companion_memory_proxy --file backups/d1-pre-import-*.sql
```

---

## 验证

迁移完成后跑烟雾测试：

```bash
npm run test:smoke -- --api-url https://<worker> --api-key <KEY>
```

---

## 全新安装

如果你是从零开始，什么都不用做。直接部署即可，记忆从一开始就会走 D1-canonical 路径。
