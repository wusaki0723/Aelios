# Aelios

> 给 AI 装一颗跨窗口的长期记忆大脑。换窗口、换客户端、换模型，记忆跟着你走。

这份 README 分两段。**上半段给人看**：草履虫也能懂，照着做就能用。**下半段给 AI 看**：端点、MCP、管线细节，给 Codex / Claude Code / Cursor 维护调试用。

- 我是人类，想部署使用 → 看 [人类版](#人类版)
- 我是 AI 助手，想维护调试 → 看 [AI 版](#ai版维护交接)

---

# 人类版

## 一句话

Aelios 是一个跑在 Cloudflare 上的记忆服务。你的 AI 客户端（Chatbox、Cherry Studio、网页、脚本）连上它之后，AI 就能**永远记住**你的偏好、规则、项目背景和重要的话——不是这一次记得，是下一次、下下次都记得。

## 它替你解决了什么

- 每次开新窗口 AI 就失忆 → 它把聊天存下来，自动整理成长期记忆，下次自动召回。
- 记忆太多把 AI 搞蠢 → 它先粗筛、再精排，原文直出进上下文。
- 换个客户端记忆就没了 → 记忆存在你自己的 Cloudflare 里，换客户端只改一个地址。
- 想给 Claude Code / Codex 加记忆 → 它能当成 MCP 工具挂上去，跨设备随身。

## 三步搞定

### 1. 部署

1. Fork [wusaki0723/Aelios](https://github.com/wusaki0723/Aelios) 到自己 GitHub。
2. Cloudflare Dashboard → Workers & Pages → Create application → 连你的 GitHub → 选你的 fork。
3. 填配置：
   - Project name: `companion-memory-proxy`
   - Production branch: `main`
   - Root directory: `/`
   - **Build command:** `npm ci`
   - **Deploy command:** `npm run deploy:cloudflare`

> ⚠️ 必须是 `npm run deploy:cloudflare`，**不是** `npm run deploy`，**不是** `wrangler deploy`。这条命令会自动建好 D1 数据库 + Vectorize 向量库 + Queue 队列。用错命令数据库不会建。

不配任何模型 key、不配 AI Gateway，记忆召回和夜间 dream 也能跑（Workers AI 默认链路）。

### 2. 设一把钥匙

部署完，去 Worker 的 Settings → Variables and Secrets 加三个：

| 变量名 | 类型 | 填什么 |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 你的 Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Secret | 你的 Cloudflare API Token |
| `CHATBOX_API_KEY` | Secret | 自己编一个密码，比如 `sk-my-aelios` |

> 名字里带 `KEY` / `TOKEN` 的必须选 **Secret**（加密、不进 git），不要选 Variable。详见 [SECRETS.md](./SECRETS.md)。

保存后重新部署。你会拿到一个地址：`https://companion-memory-proxy.<你的子域>.workers.dev`

### 3. 接客户端

以 Chatbox 为例：

- **Base URL:** `https://<你的 Worker 地址>/v1`
- **API Key:** 你设的 `CHATBOX_API_KEY`
- **Model:** `companion`

试着说："请记住：我的测试暗号是苹果星星-0428。" 过一会儿问："我的测试暗号是什么？" 答出来就通了。

## 管理面板（推荐用这个）

有面板了，**日常管记忆不用敲命令**。浏览器打开：

```
https://<你的 Worker 地址>/admin
```

填入 Worker URL 和 API Key，进去就是可视化界面，底部 5 个标签：

| 标签 | 干什么 |
|---|---|
| **今日** | 今天聊了什么、昨日日志、今日消息、记忆类型统计，一眼看完 |
| **审核队列** | dream 夜间整理和抽取的稳定事实会到这里，你点**通过 / 丢弃 / 合并 / 取代**，不让垃圾记忆污染记忆库 |
| **重要记忆** | 所有长期记忆，按类型分页浏览、搜索、编辑、删除 |
| **更多** | 珍贵记忆（只增不删的原文）、黑话表（术语别名）、世界知识、维护工具 |
| **设置** | 主题、地址、密钥 |

**想让 AI 记住什么、忘掉什么、改什么，都在面板点。** 不用调 API。

## 想要完整聊天网关（可选）

只想要记忆库可以跳过这步。想让 Aelios 当聊天转发网关：

1. Cloudflare → AI → AI Gateway → 建一个 gateway，复制地址。
2. 在 AI Gateway 的 Provider Keys 里加你的模型 API key。
3. 回 Worker → Variables and Secrets 加：

| 变量名 | 填什么 |
|---|---|
| `AI_GATEWAY_BASE_URL` | 刚复制的 Gateway Endpoint |
| `CF_AIG_TOKEN` | AI Gateway 调用 token |

保存重新部署。

> ⚠️ **用 OpenRouter 调 Claude，必须走「自定义 provider」加 key，不能用官方 provider 路径。**
> 官方 provider 路径会把请求按 Anthropic 原生格式发，和 OpenRouter 的 OpenAI 兼容格式打架，导致缓存失效、格式错乱。在 AI Gateway 里选 custom-providers 加 OpenRouter key，参考：`https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/custom-providers`。

## 给 Claude Code / Codex 加记忆（可选）

环境变量加 `MEMORY_MCP_API_KEY`，然后在客户端的 MCP 配置里填：

```
URL:    https://<你的 Worker 地址>/mcp?token=<MEMORY_MCP_API_KEY>
```

你的官方客户端就有跨设备随身记忆了。

如果你想让 Claude Code 每次发消息前自动召回长期记忆，并把对话批量写回 Aelios，可以使用仓库自带的 Claude Code Hook：

- Hook 文件：[`integrations/claude-code/companion_memory_hook.py`](./integrations/claude-code/companion_memory_hook.py)
- 安装说明：[`integrations/claude-code/README.md`](./integrations/claude-code/README.md)
- 示例配置：[`integrations/claude-code/settings.example.json`](./integrations/claude-code/settings.example.json)

Hook 只需要你的 Aelios Worker 地址和 `CHATBOX_API_KEY`，不需要任何 LLM provider key。

## 看图模式（可选）

纯文本模型看不了图？加 `GUIDE_DOG_API_KEY`，客户端改成：

- **Base URL:** `https://<你的 Worker 地址>/v1/guide-dog`
- **API Key:** `GUIDE_DOG_API_KEY`
- **Model:** `companion`

导盲犬只转述图片，不写记忆、不存聊天。

## 零配置也能用

默认链路不需要 AI Gateway、不需要第三方模型 key：embedding + reranker + dream（每天一次）都跑 Workers AI。部署时填好 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`CHATBOX_API_KEY` 就能记、能召、能夜间整理。

Workers AI 免费额度主要花在每日一次的 dream（默认 `llama-3.3-70b`）和偶尔的 reranker/embedding 上——**不再有每轮聊天的压缩模型**，额度压力小很多。真要换 `EMBEDDING_MODEL` 注意维度会变（需重建 Vectorize 索引，面板「更多 → 维护」里有工具）。

## 最容易踩的坑

- 部署命令必须是 `npm run deploy:cloudflare`，别的会覆盖变量、不建库。
- 重新部署变量不会丢（命令带 `--keep-vars`）。
- Vectorize 索引 `memo-kb`（768 维 cosine）别手动删。
- 看图会切到 `VISION_MODEL`，留意它的价格。

到这儿就够了，剩下的交给 AI。

---

# AI 版（维护交接）

> 给 Codex / Claude Code / Cursor / Gemini CLI。本节是端点、MCP、记忆管线的精确描述，用于维护和调试。

## 项目定位

Cloudflare Workers 上的 OpenAI-compatible Memory Proxy。帮用户部署时：**只关联用户自己的 fork**，Secrets / Variables 都在用户自己的 Cloudflare 账号，不要关联 wusaki0723/Aelios。

## 资源约定

| 资源 | 值 |
|---|---|
| Worker | `companion-memory-proxy` |
| D1 | `companion_memory_proxy` |
| Vectorize | `memo-kb`（768 维 cosine） |
| Queue | `companion-memory` |
| Embedding | `workers-ai/@cf/google/embeddinggemma-300m` |
| Dimensions | 768（覆盖 `EMBEDDING_MODEL` 时输出维度需匹配） |

记忆库默认走 **v2**（`MEMORY_LIFECYCLE_ENABLED` 隐式开启）：D1 是本体，Vectorize 是镜像。兼容/回退开关默认隐藏。

## 三种模式边界

| 模式 | 入口 | 做什么 | 不做什么 |
|---|---|---|---|
| 完整版 | `POST /v1/chat/completions` | 认证、模型路由、记忆召回/注入、消息存 D1、Queue 维护、D1 清理、Claude cache | — |
| 纯记忆 MCP | `/mcp` | 暴露记忆工具 | 不代理聊天 |
| 导盲犬 | `POST /v1/guide-dog/chat/completions` | 转发 + 看图 | 不写/不读记忆、不存聊天 |

## 模型路由

```
model=companion            → CHAT_MODEL
请求含 image               → VISION_MODEL
anthropic/claude*          → Anthropic native (/anthropic/v1/messages)
  ├─ 显式 cache_control 锚定稳定 system 前缀（persona_pinned / boot_stable / client_system 稳定段）
  ├─ 多断点策略：system 锚 + tail 锚 + 长 history 的 bridge 锚，≤4 个标记
  ├─ dynamic_memory_patch 后移到当前 user 块、不打 cache_control，绝不破坏缓存前缀
  └─ rolling user cache 默认开，automatic cache 默认关
custom-provider/claude-*   → Provider native (/custom-provider/messages)
其他                       → OpenAI compat (/compat/chat/completions)
workers-ai/@cf/...         → env.AI.run（不走 AI Gateway）
```

**缓存安全要点**：召回补丁（每轮都变）被从 system blocks 里剥离，作为无 `cache_control` 的文本块追加到当前 user turn 末尾，位于所有断点之后。历史轮的召回补丁已固化成稳定 history，落在 tail 断点之前，可正常命中缓存。`verify-cache-strategy.mjs` T14 校验断点数 ≤4。

**OpenRouter + Claude 路由约束**：OpenRouter 调 Claude 必须在 AI Gateway 里以 **custom-provider** 方式加 key，不能走官方 provider 路径。官方路径按 Anthropic 原生格式发请求，与 OpenRouter 的 OpenAI 兼容格式冲突，会破坏缓存和格式。模型名走 `custom-provider/claude-*` → Provider native 分支。

**Workers AI 额度**：v3 召回链路只有 embedding + reranker（每轮，用量小）+ dream（每日一次，默认 `llama-3.3-70b`），共享 Workers AI 免费额度。不再有 per-turn 压缩模型。换 `EMBEDDING_MODEL` 会改维度，需重建 Vectorize 索引。

## REST 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/admin` `/memory-admin` | 管理面板（HTML） |
| GET | `/v1/models` | 模型列表 |
| POST | `/v1/chat/completions` | 聊天网关（完整版） |
| POST | `/v1/guide-dog/chat/completions` | 导盲犬（无记忆） |
| GET / POST | `/mcp` `/memory-mcp` | MCP 端点 |
| GET / POST | `/v1/memories` `/v1/memory` | 记忆列表 / 新建（v2 必须带 `fact_key`，走 upsert） |
| GET / PATCH / DELETE | `/v1/memories/:id` `/v1/memory/:id` | 单条记忆操作 |
| POST | `/v1/search/memories` | 记忆搜索（召回用，reranker 后原文直出；`filter:false` 跳 reranker，`include_prompt:true` 拿可注入文本） |
| POST | `/v1/ingest/messages` `/v1/messages/ingest` | 写入原始聊天（v2 只落 raw） |
| GET | `/v1/memory_boot` | 冷启动包：昨日日志 + precious + glossary + 今日消息 + 统计 |
| GET | `/v1/diary?date=YYYY-MM-DD` | 读单日日记（`daily_log`）；无记录 404 |
| GET | `/v1/diary/recent` | 今日+昨日日记（存在几条给几条） |
| GET / POST / DELETE | `/v1/precious` `/v1/precious/:id` | 珍贵记忆（只增不删的原文） |
| GET / POST / PATCH / DELETE | `/v1/glossary` `/v1/glossary/:id` | 黑话表（term + aliases + definition） |
| GET | `/v1/candidates` | 候选审核队列列表（`status` 默认 pending） |
| POST | `/v1/candidates/:id/approve` | 通过候选 → 落库 |
| POST | `/v1/candidates/:id/discard` | 丢弃候选 |
| POST | `/v1/candidates/:id/merge` | 合并到既有记忆（`target_id`） |
| POST | `/v1/candidates/:id/supersede` | 取代既有记忆（`target_id`） |
| GET / PUT / DELETE | `/v1/cache/:namespace/:key` | 缓存 CRUD |
| GET | `/api/memories/export` | 记忆导出 |
| GET | `/v1/debug/cache_health` | 缓存健康 |
| GET | `/v1/debug/vector_health` | 向量库健康 |
| POST | `/v1/debug/vector_reindex` | 向量重建 |

所有非 `/health` `/admin` `/v1/models` 端点都要 `Authorization: Bearer <CHATBOX_API_KEY>`，按 scope（`memory:read` / `memory:write`）鉴权。

## MCP 工具（`/mcp`）

v2 暴露 14 个工具。`memory_create`、`digest_get`、`digest_set` 已废弃；日记用 `diary_get`。

| 工具 | 作用 | 关键参数 / 备注 |
|---|---|---|
| `memory_search` | 向量搜索长期记忆 | `query`；`min_score`（0–1，默认 0.15） |
| `memory_list` | 列记忆 | `type` / `status` / `limit` / `cursor` |
| `memory_export` | 导出记忆 | 返回全量 |
| `memory_get` | 取单条 | `id` |
| `memory_delete` | 软删 | `id` |
| `memory_ingest` | 写入消息 + 触发维护 | v2 只落 raw |
| `memory_boot` | 拉冷启动包 | 昨日日志 + precious + glossary |
| `diary_get` | 读日记 | `date` 可选，缺省=今日+昨日 |
| `memory_recall` | 召回并返回可注入文本 | 用于 MCP 客户端自己拼上下文 |
| `memory_pin` | 写珍贵记忆 | 只增不删 |
| `glossary_set` | 写黑话术语 | term / aliases / definition |
| `memory_upsert` | v2 主写入（需 `fact_key`） | 撞键 → supersede / mark-seen |
| `memory_supersede` | 显式取代 | `old_id` + 新内容 |
| `memory_archive` | 归档 | `id` |
## 记忆管线（v3）

**写入：**

```
agent 直写：memory_upsert / memory_supersede（MCP 或 REST）→ 直接落库
dream 夜间（cron `10 20 * * *`）：
  ├─ 从当天 raw messages 抽稳定事实 → 全部进 candidates（status=pending）
  ├─ 合并/更新/删除建议 → 同样进 candidates（world_fact supersede 除外，直接落库）
  ├─ 重要原文摘录 → candidates
  └─ 写 daily_log（title + summary）
```

**召回（聊天前 / memory_recall）：**

```
取最后一条 user 消息 → embedding → Vectorize 搜索
→ 分数地板 → 去重 → reranker 重排 → 记忆原文直出（默认 k=3, min_score=0.15）
→ dynamic_memory_patch 追加到当前 user turn（不打 cache_control）
```

**日记：** `GET /v1/diary` 或 MCP `diary_get`——agent 自己 fetch，**永不自动注入**。

### GitHub daily source

cmh-lite 客户端每天 23:50（本地时区）会把 `archive/daily/YYYY-MM-DD.md` push 到 GitHub 私库。Aelios 在现有 cron（`10 20 * * *` UTC = 04:10 SGT，晚于 push 约 4 小时）里顺带拉取**昨天**的 daily 文件，解析 turn 行与 checkpoint writer 摘要，走与 `/v1/ingest/messages` 相同的 `saveIngestMessages` 管道入库，供夜间 dream 整理。

| 变量 | 默认 | 说明 |
|---|---|---|
| `GITHUB_DAILY_REPO` | 空（禁用） | `owner/repo` 格式 |
| `GITHUB_DAILY_PATH` | `archive/daily` | 仓库内目录 |
| `GITHUB_DAILY_NAMESPACE` | `DREAM_NAMESPACE` 或 `default` | 入库 namespace |
| `GITHUB_DAILY_TOKEN` | Secret | fine-grained PAT，**只读**目标仓库 Contents |

对接 cmh-lite 时把 Worker 的 `GITHUB_DAILY_REPO` 指到同一私库即可（客户端仓库说明见 [cmh-lite](https://github.com/PLACEHOLDER/cmh-lite)）。

**清理（后台 Queue，24h 节流）：**

```
messages: 14 天删
usage_logs: 30 天删
memory_events: 30 天删
idempotency_keys: 7 天删
memories: 非 pinned/identity/persona 180 天标 expired → 同步删 Vectorize
hard delete: deleted/superseded/expired 超 30 天 → 先删 Vectorize 再删 D1
（Vectorize 失败不删 D1，避免失配）
```

## 环境变量速查

### 最小必填

| 变量 | 说明 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（Secret） |
| `CHATBOX_API_KEY` | 客户端 + 面板访问密钥（Secret） |

### 完整网关加填

| 变量 | 说明 |
|---|---|
| `AI_GATEWAY_BASE_URL` | AI Gateway Endpoint |
| `CF_AIG_TOKEN` | AI Gateway 调用 token |

### 模型（都有默认）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CHAT_MODEL` | `deepseek/deepseek-v4-pro` | 主聊天 |
| `DREAM_MODEL` | `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 夜间 dream（抽取+整理） |
| `VISION_MODEL` | `google-ai-studio/gemini-3-flash-preview` | 看图 |
| `EMBEDDING_MODEL` | `workers-ai/@cf/google/embeddinggemma-300m` | 嵌入 |
| `EMBEDDING_DIMENSIONS` | `768` | 非 Workers AI embedding 目标维度 |
| `MEMORY_RERANKER_MODEL` | `workers-ai/@cf/baai/bge-reranker-base` | reranker |
| `ENABLE_MEMORY_RERANKER` | `true` | `false` 跳过 |

### 记忆召回 / dream

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEDUP_COSINE` | `0.9` | embedding 判重阈值（judge 等） |
| `MEMORY_FILTER_MAX_CANDIDATES` | `12` | 进 reranker 候选上限 |
| `MEMORY_FILTER_MAX_OUTPUT` | `3` | 注入条数（代理默认 k） |
| `MEMORY_FILTER_MIN_SCORE` | `0.1` | 进 reranker 前地板（故意低） |
| `RECALL_MIN_SCORE` | `0.15` | 召回分数地板 |
| `MEMORY_MIN_IMPORTANCE` | `0.55` | 写入最低重要性 |
| `DREAM_TIME_ZONE` | `Asia/Singapore` | 按此时区切自然日 |
| `DREAM_MAX_MESSAGES` | `40` | 每次 dream 最多消息数 |
| `DREAM_MAX_RUNS` | `10` | 每次 cron 最多 dream 批数 |
| `DREAM_MAX_TOKENS` | `8000` | dream 输出上限 |
| `DREAM_MEMORY_CONTEXT_LIMIT` | `40` | dream 参考旧记忆数 |
| `DREAM_EXCERPT_LIMIT` | `8` | 每天最多原文段落数 |
| `GITHUB_DAILY_REPO` | 空 | GitHub daily 源仓库，`owner/repo`；空 = 禁用 |
| `GITHUB_DAILY_PATH` | `archive/daily` | daily markdown 目录 |
| `GITHUB_DAILY_NAMESPACE` | 空 | 入库 namespace，默认跟 `DREAM_NAMESPACE` |
| `GITHUB_DAILY_TOKEN` | Secret | fine-grained PAT，只读目标仓库 Contents |

### Claude 缓存

| 变量 | 默认 | 说明 |
|---|---|---|
| `ANTHROPIC_CACHE_ENABLED` | `true` | prompt cache 开关 |
| `ANTHROPIC_CACHE_TTL` | `5m` | `5m` / `1h` |
| `ANTHROPIC_AUTO_CACHE_ENABLED` | `true` | 顶层 automatic cache |
| `ANTHROPIC_ROLLING_CACHE_ENABLED` | `true` | 滚动打点 |
| `ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE` | `20` | 历史窗口 |
| `ANTHROPIC_CACHE_USER_ID` | 空 | 多客户端 cache 隔离用 `metadata.user_id` |
| `ANTHROPIC_THINKING_ENABLED` | `false` | 深度思考 |
| `ANTHROPIC_THINKING_BUDGET` | `1024` | 思考 token（1024–32000） |
| `FORCE_ANTHROPIC_NATIVE` | 空 | `true` 强制 Anthropic native |
| `CUSTOM_ANTHROPIC_MESSAGES_PATH` | `messages` | 原生 messages 路径 |

### 高级

| 变量 | 默认 | 说明 |
|---|---|---|
| `MEMORY_TOP_K` | `50` | 向量粗召回条数 |
| `MEMORY_MIN_SCORE` | `0.1` | 召回地板（故意低，精排交给 reranker） |
| `MEMORY_FILTER_MAX_CONTENT_CHARS` | `700` | 候选每条保留字数 |
| `VECTORIZE_INDEX_NAME` | `memo-kb` | Vectorize 索引名 |
| `ENABLE_AUTO_MEMORY` | 空（开启） | `false` 关自动记忆 |
| `EMPTY_MEMORY_MIN_CHARS` | `4` | 清短空记忆阈值 |
| `PUBLIC_MODEL_NAME` | `companion` | 客户端看到的模型名 |
| `IM_API_KEY` | 空 | 第二把钥匙（IM bot） |
| `DEBUG_API_KEY` | 空 | 调试接口钥匙 |
| `MEMORY_MCP_API_KEY` | 空 | 纯记忆 MCP 单独钥匙 |
| `GUIDE_DOG_API_KEY` | 空 | 导盲犬单独钥匙 |

## 本地开发与验证

```bash
npm install
npm run deploy:cloudflare   # 建库 + 升级 + 部署
npm run worker:test         # 主测试套件（177 项）
node scripts/verify-extract-pipeline.mjs   # 4h 抽取管线行为测试
node scripts/verify-cache-strategy.mjs     # Claude 缓存断点策略（15 项）
npx tsc --noEmit            # 类型检查
```

改记忆 / 缓存 / 抽取相关代码后，至少跑后三个脚本。

## 记忆库清洗

旧 Vectorize 里长块、多主题块、重复总结多时，可让 LLM 先生成清洗计划：

```bash
AELIOS_BASE_URL="https://<worker>" \
AELIOS_API_KEY="<CHATBOX_API_KEY>" \
AI_GATEWAY_BASE_URL="<AI Gateway Endpoint>" \
CF_AIG_TOKEN="<AI Gateway Token>" \
CLEANUP_MODEL="deepseek/deepseek-v4-flash" \
npm run vectorize:clean:llm
```

## License

MIT

## 交流与反馈

有问题、想交流，欢迎来 QQ 群：**1091783659**
