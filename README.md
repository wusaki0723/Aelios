# Companion Memory Proxy (Aelios)

部署在 Cloudflare Workers 上的 OpenAI-compatible 记忆网关。

这个仓库现在有三种用法。**默认先用完整版就行**，后两个是给有特殊需求的人开的轻量入口：

1. **完整版**：聊天网关 + 记忆注入 + 每日小秘书整理 + Claude cache。大多数人用这个。
2. **纯记忆库 MCP**：只把记忆库暴露成 MCP 工具，给 Claude、Codex、MCP 客户端调用。
3. **无记忆导盲犬 API**：只做看图/转发，不保存消息，不搜索记忆，不碰 D1。

Chatbox、Cherry Studio、网页前端、IM bot 等支持 OpenAI API 的客户端，接上完整版就能用：

- `/v1/chat/completions` 聊天
- 自动长期记忆注入
- 每日小秘书整理：原始聊天先存 D1，凌晨统一生成摘要、重要原文和少量长期记忆
- Vectorize 语义搜索
- Cloudflare AI Gateway 统一代理
- Claude 自动路由 + prompt cache
- 图片自动走视觉模型
- D1 自动清理过期数据

新增的轻量入口：

- `/mcp` 纯记忆库 MCP
- `/v1/guide-dog/chat/completions` 无记忆导盲犬 API

---

## 人类版：照着点就行

你不用看代码。卡住了就把这个项目的链接发给你的 AI，让它照下面的"AI 版"帮你操作。

### 第一步：Fork 项目

打开项目地址，点右上角 `Fork` -> `Create fork`：

```
https://github.com/wusaki0723/Aelios
```

Fork 完你会得到自己的仓库：

```
https://github.com/<你的名字>/Aelios
```

### 第二步：Cloudflare 关联你的 Fork

```
Cloudflare Dashboard
  -> Workers & Pages
  -> Create application
  -> Import a repository
  -> 选 GitHub
  -> 选 <你的名字>/Aelios
```

配置这样填：

```
Project name:       companion-memory-proxy
Production branch:  main
Root directory:     /
Build command:      npm ci
Deploy command:     npm run deploy:cloudflare
```

**Deploy command 不要改！** 必须是 `npm run deploy:cloudflare`。它会自动建 D1、Vectorize、Queue、跑数据库升级、再部署。

### 第三步：填必填变量

在 Cloudflare 项目 -> `Variables and Secrets` 里添加：

| 变量名 | 在哪里找 | 说明 |
|--------|---------|------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 右侧/URL 里 | 你的 Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Tokens 页面 | 给 Worker 调 Vectorize 管理 API 用 |
| `AI_GATEWAY_BASE_URL` | Cloudflare AI Gateway 页面 | 你的网关地址，长这样：`https://gateway.ai.cloudflare.com/v1/xxx/yyy` |
| `CF_AIG_TOKEN` | Cloudflare Dashboard | AI Gateway 调用用的 token |
| `CHATBOX_API_KEY` | 你自己编一个 | 客户端连接用的密码，例如 `sk-my-key-123` |

填完这些，**完整版**就能跑了。MCP 和导盲犬 API 不用先管。

`CLOUDFLARE_API_TOKEN` 至少需要 Vectorize Read 权限；如果你要用 MCP 删除记忆、运行清理脚本，给它 Vectorize Write 权限。

### 第四步：改模型（可选）

模型已经在代码里配好了默认值，**不改也能用**。想换模型的话：

| 变量名 | 默认值 | 干嘛的 |
|--------|--------|--------|
| `CHAT_MODEL` | `deepseek/deepseek-v4-pro` | 主聊天模型 |
| `MEMORY_FILTER_MODEL` | `google-ai-studio/gemini-2.5-flash-lite` | 记忆筛选压缩小秘书，模型名前缀决定 provider |
| `MEMORY_FILTER_MAX_CANDIDATES` | `12` | 每次最多交给小秘书的候选记忆 |
| `MEMORY_FILTER_MAX_OUTPUT` | `6` | 小秘书最多返回几条记忆 |
| `MEMORY_FILTER_OUTPUT_CHARS` | `300` | 小秘书每条返回内容最多多少字 |
| `MEMORY_MODEL` | `deepseek/deepseek-v4-flash` | 记忆抽取 + 摘要（快且便宜） |
| `VISION_MODEL` | `google-ai-studio/gemini-3-flash-preview` | 看图 |
| `SUMMARY_MODEL` | 不填，用 `MEMORY_MODEL` | 长期摘要生成（可选覆盖） |
| `EMBEDDING_MODEL` | `google-ai-studio/gemini-embedding-2` | 向量嵌入 |
| `EMBEDDING_DIMENSIONS` | `768` | 非 Workers AI embedding 请求的目标维度 |

想换模型？直接在 Cloudflare Dashboard 的 Variables 里改，不用动代码。

模型名格式是 `provider/model`，比如：
- `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `worker/@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `deepseek/deepseek-v4-pro`
- `google-ai-studio/gemini-2.5-flash`
- `anthropic/claude-sonnet-4-6`
- `openai/gpt-4o`

### 第五步：点 Deploy

部署成功后你的地址长这样：

```
https://companion-memory-proxy.<你的子域>.workers.dev
```

### 第六步：客户端这样填

以 Chatbox 为例：

```
Base URL:   https://<你的 Worker 地址>/v1
API Key:    你第三步填的 CHATBOX_API_KEY
Model:      companion
```

### 可选：开启另外两个轻量入口

这一步不是必须的。你不填下面两个 key，完整版照样能用。

**纯记忆库 MCP：**

在 Cloudflare Variables 里加：

```
MEMORY_MCP_API_KEY = 你自己编一个密码
```

MCP 地址：

```
https://<你的 Worker 地址>/mcp?token=<MEMORY_MCP_API_KEY>
```

**无记忆导盲犬 API：**

在 Cloudflare Variables 里加：

```
GUIDE_DOG_API_KEY = 你自己编一个密码
```

客户端这样填：

```
Base URL:   https://<你的 Worker 地址>/v1/guide-dog
API Key:    你填的 GUIDE_DOG_API_KEY
Model:      companion
```

导盲犬只转发模型，不写记忆、不读记忆、不保存聊天记录。

### 第七步：验证

打开浏览器访问：

```
https://<你的 Worker 地址>/health
```

看到 `ok: true` 就成功了。

然后在 Chatbox 里说：

```
请记住：我的常用暗号是苹果星星-0428。
```

过十几秒再问：

```
我的常用暗号是什么？
```

能答出来就搞定了。

### 所有环境变量速查表

**必填：**

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 是 | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | 是 | Cloudflare API Token，用于 Vectorize list/get/delete |
| `AI_GATEWAY_BASE_URL` | 是 | Cloudflare AI Gateway 地址 |
| `CF_AIG_TOKEN` | 是 | AI Gateway 调用用的 token |
| `CHATBOX_API_KEY` | 是 | 客户端连接密码 |

**模型（都有默认值，可选改）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CHAT_MODEL` | `deepseek/deepseek-v4-pro` | 主聊天 |
| `MEMORY_FILTER_MODEL` | `google-ai-studio/gemini-2.5-flash-lite` | 记忆筛选，模型名前缀决定 provider |
| `MEMORY_FILTER_MAX_CANDIDATES` | `12` | 进入小秘书的候选记忆上限 |
| `MEMORY_FILTER_MAX_OUTPUT` | `6` | 小秘书最终返回记忆上限 |
| `MEMORY_FILTER_OUTPUT_CHARS` | `300` | 小秘书每条返回内容最多多少字 |
| `MEMORY_MODEL` | `deepseek/deepseek-v4-flash` | 记忆抽取 |
| `VISION_MODEL` | `google-ai-studio/gemini-3-flash-preview` | 看图 |
| `SUMMARY_MODEL` | 空（用 MEMORY_MODEL） | 摘要生成 |
| `EMBEDDING_MODEL` | `google-ai-studio/gemini-embedding-2` | 向量嵌入 |
| `EMBEDDING_DIMENSIONS` | `768` | 非 Workers AI embedding 请求的目标维度 |

**Claude 专属（可选）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ANTHROPIC_THINKING_ENABLED` | `false` | 开启 Claude 深度思考 |
| `ANTHROPIC_THINKING_BUDGET` | `1024` | 思考 token 预算（1024-32000） |
| `ANTHROPIC_CACHE_TTL` | `5m` | Prompt cache 时长（`5m` 或 `1h`） |
| `ANTHROPIC_CACHE_ENABLED` | `true` | 设 `false` 关闭 cache |
| `ANTHROPIC_AUTO_CACHE_ENABLED` | `true` | 开启 Anthropic 顶层自动缓存，让多轮历史像 Claude Code 一样向后滚动缓存 |
| `ANTHROPIC_ROLLING_CACHE_ENABLED` | `true` | 在最后一条 user 内容上显式打 cache_control。部分中转不支持 automatic 时，这个更接近 Claude Code |
| `FORCE_ANTHROPIC_NATIVE` | 空 | 设 `true` 强制所有模型走 Anthropic native |
| `CUSTOM_ANTHROPIC_MESSAGES_PATH` | `messages` | custom Claude 的原生 messages 路径 |

**高级（一般不用动）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `IM_API_KEY` | 空 | 第二把钥匙（IM bot 用） |
| `DEBUG_API_KEY` | 空 | 调试接口钥匙 |
| `MEMORY_TOP_K` | `12` | 记忆搜索返回条数 |
| `MEMORY_MIN_SCORE` | `0.35` | 记忆搜索最低相关度 |
| `MEMORY_FILTER_MIN_SCORE` | `0.35` | 进入小秘书前的最低相关度；不填时跟随 `MEMORY_MIN_SCORE` |
| `MEMORY_FILTER_MAX_CONTENT_CHARS` | `700` | 交给小秘书前，每条候选最多保留多少字 |
| `MEMORY_MIN_IMPORTANCE` | `0.55` | 记忆写入最低重要性 |
| `MEMORY_BACKEND` | `vectorize` | 长期记忆主库。默认 Vectorize；设 `d1` 可回到旧模式 |
| `VECTORIZE_INDEX_NAME` | `memo-kb` | Vectorize 索引名，给 list-vectors API 使用 |
| `ENABLE_AUTO_MEMORY` | 空（开启） | 设 `false` 关闭自动记忆 |
| `ENABLE_INCREMENTAL_MEMORY` | `false` | 设 `true` 才恢复每轮聊天后即时抽取 |
| `ENABLE_DAILY_MEMORY_DIGEST` | `true` | 每日小秘书整理原始聊天 |
| `DAILY_DIGEST_TIME_ZONE` | `Asia/Singapore` | 每日摘要日期使用的时区 |
| `DAILY_DIGEST_MAX_MESSAGES` | `320` | 每次每日整理最多处理的原始消息数 |
| `DAILY_DIGEST_MEMORY_CONTEXT_LIMIT` | `250` | 每日整理时提供给模型参考的旧记忆数量 |
| `DAILY_DIGEST_EXCERPT_LIMIT` | `8` | 每日最多保存的重要原文段落 |
| `EMPTY_MEMORY_MIN_CHARS` | `4` | 每日整理时清理短空记忆的阈值 |
| `PUBLIC_MODEL_NAME` | `companion` | 客户端看到的模型名 |
| `MEMORY_MCP_API_KEY` | 空 | 纯记忆库 MCP 的单独钥匙 |
| `GUIDE_DOG_API_KEY` | 空 | 无记忆导盲犬 API 的单独钥匙 |
| `GUIDE_DOG_MODEL` | `VISION_MODEL` 默认同款 | 导盲犬 API 专用模型 |

### 最容易踩的坑

```
Deploy command 必须是 npm run deploy:cloudflare
  -> 不是 npm run deploy，不是 wrangler deploy
  -> 否则变量会被覆盖、数据库不会升级

重新部署变量不会丢
  -> deploy:cloudflare 带 --keep-vars

Vectorize 不要手动删
  -> 默认索引 memo-kb，768 维 cosine

看图会切换到 VISION_MODEL
  -> 确认 VISION_MODEL 是你能接受的价格
```

---

## AI 版：详细交接说明

这一节给 Codex、Claude Code、Cursor、Gemini CLI 等 AI 助手看。

### 项目定位

Cloudflare Workers 上的 OpenAI-compatible Memory Proxy。

如果你在帮新用户部署：

```
1. 指导用户 fork 源项目到自己的 GitHub
2. Cloudflare 只关联用户自己的 fork
3. Secrets / Variables 都在用户自己的 Cloudflare 账号
4. 不要直接关联 wusaki0723/Aelios
```

### 对外接口

```
GET    /health
GET    /v1/models
POST   /v1/chat/completions
POST   /v1/guide-dog/chat/completions
POST   /guide-dog/v1/chat/completions
GET    /mcp
POST   /mcp
GET    /v1/memories
POST   /v1/memories
POST   /v1/memories/search
POST   /v1/memories/ingest
GET    /v1/memories/:id
PATCH  /v1/memories/:id
DELETE /v1/memories/:id
GET    /v1/memory
POST   /v1/memory
POST   /v1/memory/search
GET    /v1/memory/:id
PATCH  /v1/memory/:id
DELETE /v1/memory/:id
GET/PUT/DELETE /v1/cache/:namespace/:key
GET    /v1/debug/cache_health
```

### 三种模式的边界

**1. 完整版（默认）**

```
POST /v1/chat/completions
```

会做：认证、模型路由、记忆搜索/注入、用户消息保存、助手回复保存、Queue 记忆维护、长期摘要、D1 生命周期清理、Claude cache。

**2. 纯记忆库 MCP**

```
GET/POST /mcp
```

只暴露记忆工具，不代理聊天模型。支持 Bearer token，也支持 MCP 客户端常见的 URL token：

```
https://<worker>/mcp?token=<MEMORY_MCP_API_KEY>
```

工具：

```
memory_search  搜索长期记忆
memory_create  手工创建一条长期记忆
memory_list    列出长期记忆
memory_ingest  写入一段消息，并可触发自动抽取
```

`memory_ingest` 默认会触发自动抽取；只想存消息、不想调用记忆模型时，传 `auto_extract: false`。

这个模式使用 D1、Vectorize、Queue，但不使用 `/v1/chat/completions`。

直接管理长期记忆库时，用 REST CRUD；这一路返回的是 Vectorize 原始记忆，不经过小秘书压缩：

```
GET    /v1/memory
POST   /v1/memory
GET    /v1/memory/:id
PATCH  /v1/memory/:id
DELETE /v1/memory/:id
```

兼容路径 `/v1/memories` 也会走同一套 Vectorize 原始记忆管理。

如果不想走 MCP，也可以直接走 REST 写入原始聊天：

```
POST /v1/memories/ingest
POST /v1/ingest/messages
POST /v1/messages/ingest
```

这三个入口做的是同一件事：鉴权后把 `messages` 写进 D1。传 `auto_extract: false` 时，只保存原始聊天，等每日小秘书晚上统一整理入 Vectorize。

每轮 hook 搜索长期记忆也可以直接走 REST，不用 MCP 握手：

```
POST /v1/memories/search
POST /v1/memory/search
POST /v1/search/memories
```

默认走 Vectorize 搜索，再用记忆小秘书分拣压缩。想要最低延迟时传 `filter: false`，只返回原始向量命中；想直接拿一段可塞进 prompt 的文本时传 `include_prompt: true`。

简单说：`/v1/memory/search` 是给模型召回用的，可能被小秘书加工；`/v1/memory/:id` 和列表/创建/修改/删除是给人或脚本管理原始记忆库用的。

**3. 无记忆导盲犬 API**

```
POST /v1/guide-dog/chat/completions
POST /guide-dog/v1/chat/completions
```

只做 OpenAI-compatible 转发，默认优先用 `GUIDE_DOG_MODEL`，不填就用 `VISION_MODEL`/`CHAT_MODEL`。它不会保存消息，不会注入记忆，不会触发 Queue，适合单独做“看图描述/识别/辅助导航”。

导盲犬 API 是纯转发入口，不走完整版的输出过滤；如果上游模型返回 `reasoning_content` 或其他思考字段，会原样交给客户端。

### 核心架构

```
前端负责：角色卡、聊天风格、工具、网页搜索、当前上下文
Worker 负责：统一 API、记忆注入/写入、摘要、Claude cache、AI Gateway 代理
```

**资源约定：**

```
Worker:      companion-memory-proxy
D1:          companion_memory_proxy
Vectorize:   memo-kb (768 维 cosine)
Queue:       companion-memory
Embedding:   google-ai-studio/gemini-embedding-2
Dimensions:  768 (如覆盖 EMBEDDING_MODEL，输出维度仍需匹配)
```

### 模型路由

聊天和非 Workers AI 模型调用走 Cloudflare AI Gateway。`workers-ai/`、`worker/`、`@cf/` 前缀的筛选和 embedding 会直接走 Worker 的 Workers AI binding。

```
用户传 model=companion
  -> resolveTargetModel -> CHAT_MODEL

请求含 image_url/input_image
  -> VISION_MODEL

目标模型名含 anthropic 或 claude
  -> Anthropic native: <AI_GATEWAY_BASE_URL>/anthropic/v1/messages
  -> 顶层 automatic cache_control 负责缓存增长中的多轮历史
  -> 显式 cache_control on client_system block 负责缓存稳定 system 前缀
  -> 显式 cache_control on last user block 负责滚动缓存对话历史
  -> cf-aig-skip-cache: true

目标模型名是 custom-provider/claude-opus-4-7 这类 custom Claude
  -> Provider-specific native: <AI_GATEWAY_BASE_URL>/custom-provider/messages
  -> 发给上游的 model 会变成 claude-opus-4-7
  -> 仍然保留 Anthropic cache_control
  -> 如果 custom provider 的 base_url 没有 /v1，把 CUSTOM_ANTHROPIC_MESSAGES_PATH 改成 v1/messages

其他模型
  -> OpenAI compat: <AI_GATEWAY_BASE_URL>/compat/chat/completions

Embedding
  -> workers-ai/@cf/... 或 @cf/...: env.AI.run
  -> 其他 provider/model: <AI_GATEWAY_BASE_URL>/compat/embeddings
```

非 Claude 模型走 OpenAI-compatible 穿透，不加 Claude-only 参数。非 Claude 会剥离顶层 `thinking` 字段。

### Prompt Assembler (v4)

组装顺序（9 个 block，单一线性）：

```
system_blocks:
  1. proxy_static_rules    (stable)  — 不暴露后端的规则
  2. persona_pinned        (stable)  — identity/persona 记忆
  3. long_term_summary     (stable)  — 长期对话摘要（≤2000字）
  4. preset_lite           (stable)  — 输出风格指令
  5. client_system         (stable)  — 前端 system 消息 [CACHE ANCHOR]
  6. dynamic_memory_patch  (dynamic) — RAG 命中的记忆
  7. vision_context        (dynamic) — 视觉描述

messages:
  8. recent_history        — 历史消息（仅 user/assistant）
  9. current_user          — 当前用户消息（保留原始 content，图片不丢）
```

默认会同时使用三层 Claude prompt cache：

- 顶层 automatic `cache_control`：Anthropic 会自动把缓存断点放到最后一个可缓存 block，并随着多轮历史增长向后推进。这更接近 Claude Code 的命中形态。
- 显式 `cache_control`：仍然落在 client_system（block 5），保证前面的 stable blocks 有独立缓存。
- 滚动显式 `cache_control`：额外落在最后一条 user 内容上。实测部分中转会忽略顶层 automatic，但支持这个显式断点，命中形态会变成 `input` 很小、`cache_read` 随历史增长、`cache_creation` 写入新增段。

如果发现动态记忆每轮变化太大，导致 system 层频繁失效，可以优先减少 RAG 注入内容，或把 `ANTHROPIC_AUTO_CACHE_ENABLED=false` 退回只缓存稳定 system 的模式。

tool/tool_calls 请求 fallback 到旧路径，assembler 不处理 tool。

### Regex / 输出过滤

流式和非流式都走同一套规则：

```
strip_thinking:     去掉 <thinking>...</thinking>
strip_lang_details: 去掉 English/Japanese <details> block
strip_solid_square: 去掉 ■
dash_to_comma:      —、——、– 改成 ，
```

- `reasoning_content`（CoT）永远不被过滤
- 历史消息只清理 `strip_thinking`，不动当前用户消息
- 流式 dash 跨 chunk 折叠已对齐

### 记忆系统完整流程

**聊天前（注入）：**

```
取最后一条 user 消息文本
  -> EMBEDDING_MODEL 生成向量
  -> Vectorize 搜索 memo-kb（长期记忆主库）
  -> 从 Vectorize metadata 读取 content/type/tags/importance/status
  -> 分数过滤 + 去重 + 截断候选
  -> Workers AI / MEMORY_FILTER_MODEL 用 JSON mode 分拣压缩
  -> 注入 dynamic_memory_patch
  -> pinned identity/persona -> persona_pinned block
```

**聊天后（维护）：**

```
保存 user/assistant messages 到 D1
  -> 默认不即时写入长期记忆
  -> 每天 04:10（Asia/Singapore）触发 scheduled 小秘书
    -> 读取上次整理后的原始聊天
    -> 读取一批 Vectorize 旧 active 记忆作为参考
    -> 清理空/过短记忆
    -> SUMMARY_MODEL/MEMORY_MODEL 生成固定格式日摘要
    -> 保存 daily_summary + important excerpt
    -> 新增少量高质量长期记忆
    -> 更新/删除冲突、重复、过期旧记忆
    -> 原始 messages 只保留 3 天
```

如果你想恢复旧版“每轮聊天后就抽取长期记忆”的行为，把 `ENABLE_INCREMENTAL_MEMORY=true` 加到 Cloudflare Variables。

**聊天后（清理）：**

```
后台 Queue: retention（24h 节流）
  -> messages: 14 天前删除
  -> usage_logs: 30 天前删除
  -> memory_events: 30 天前删除
  -> idempotency_keys: 7 天前删除
  -> memories: 非 pinned/identity/persona 180 天标 expired
    -> 标记后同步删除 Vectorize 向量
  -> hard delete: deleted/superseded/expired 超 30 天
    -> 先删 Vectorize 向量（分批 100）
    -> 成功后再删 D1（分批 100）
    -> Vectorize 失败不删 D1，避免失配
```

### Claude Thinking / CoT

支持多种前端传参方式：

```
reasoning_effort: "high" | "medium" | "low" | "none"
thinking: true | false | { type: "enabled", budget_tokens: 2048 }
enable_thinking: true
extra_body.reasoning_effort / extra_body.thinking
```

环境变量兜底：

```
ANTHROPIC_THINKING_ENABLED=true  -> 默认开启
ANTHROPIC_THINKING_BUDGET=2048   -> 默认预算
```

前端传参优先级高于环境变量。`thinking: false` 可以关闭环境变量默认开启。

非 Claude 模型不加 thinking 参数。DeepSeek 等模型的顶层 `thinking` 字段会被剥离。

### Queue 机制

```
producer:
  env.MEMORY_QUEUE 存在 -> env.MEMORY_QUEUE.send(message)
  不存在 -> fallback handleQueueMessage（本地开发）

consumer (src/index.ts queue handler):
  memory_maintenance -> runMemoryMaintenance + maybeUpdateLongTermSummary
  retention -> runMemoryRetention
```

消息类型：

```typescript
MemoryMaintenanceQueueMessage {
  type: "memory_maintenance"
  namespace, conversationId, fromMessageId, toMessageId, source, idempotencyKey
}

RetentionQueueMessage {
  type: "retention"
  namespace
}
```

### D1 表结构

```
users, conversations, messages, memories, memory_events,
summaries, cache_entries, processing_cursors, idempotency_keys, usage_logs
```

关键索引：

```
messages: (namespace, created_at), (conversation_id, created_at)
memories: (namespace, status), (type), (pinned)
```

### 本地开发命令

```bash
npm ci                    # 安装依赖
npm run typecheck         # TypeScript 类型检查
npm run dev               # 本地 wrangler dev
npm run setup:cloudflare  # 创建/升级 D1 + Vectorize + Queue
npm run deploy:cloudflare # setup + deploy（生产用）
node scripts/verify-assembler.mjs  # 合约测试（194 项）
```

### 验证脚本

`scripts/verify-assembler.mjs` 是纯 JS 合约镜像，不依赖 TS runtime：

```
Test  1: Determinism
Test  2: Pinned sort stability
Test  3: Cache anchor position
Test  4: Image passthrough
Test  5: Tool filtering
Test  6: Anthropic conversion
Test  7: OpenAI conversion
Test  8: OpenAI path branching
Test  9: Anthropic path
Test 10: pinnedPersonaMemories filtering
Test 11: Adapter helpers
Test 12: Cache metadata
Test 13: Thinking + prompt trim
Test 14: Regex Pipeline
Test 15: D1 Lifecycle Retention
Test 16: Memory Merge / Supersede
Test 17: Long-Term Summary
Test 18: Queue Send / Fallback
```

### 手工验收命令

```bash
# 健康检查
curl "https://<worker>/health"

# 模型列表
curl "https://<worker>/v1/models" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>"

# 文本聊天
curl "https://<worker>/v1/chat/completions" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"model":"companion","stream":false,"messages":[{"role":"user","content":"你好"}],"max_tokens":80}'

# 图片模型测试
curl "https://<worker>/v1/chat/completions" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"model":"companion","stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"这张图里最大的英文单词是什么？只回答那个单词。"},{"type":"image_url","image_url":{"url":"https://dummyimage.com/160x80/00ff00/000000.png&text=GREEN"}}]}],"max_tokens":80}'

# 自动写记忆
curl "https://<worker>/v1/chat/completions" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"model":"companion","stream":false,"messages":[{"role":"user","content":"请记住：我的测试暗号是星线-0428。"}],"max_tokens":80}'

# 搜索记忆
curl "https://<worker>/v1/memories/search" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"query":"星线-0428","top_k":5}'

# 每轮 hook 快速搜记忆：不走 MCP，跳过小秘书压缩，返回最快原始命中
curl "https://<worker>/v1/memory/search" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"query":"用户这轮消息文本","top_k":8,"filter":false,"include_prompt":true}'

# 直接管理原始长期记忆：列表 / 创建 / 修改 / 删除都不经过小秘书
curl "https://<worker>/v1/memory?limit=20" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>"

curl "https://<worker>/v1/memory" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"type":"note","content":"用户喜欢把直接管理的长期记忆保存在 Vectorize。","importance":0.7,"tags":["manual"]}'

# 直接上传外部聊天到 D1，不走 MCP，不立即抽取长期记忆
curl "https://<worker>/v1/ingest/messages" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"conversation_id":"claude-code-2026-05-15","source":"claude-code","auto_extract":false,"messages":[{"role":"user","content":"今天在 Claude Code 里讨论了 Aelios 的记忆结构。"},{"role":"assistant","content":"确认了 D1 做临时聊天台账，Vectorize 做长期记忆主库。"}]}'

# Cache 健康（需要 DEBUG_API_KEY）
curl "https://<worker>/v1/debug/cache_health" \
  -H "Authorization: Bearer <DEBUG_API_KEY>"

# Claude cache 实测：连续打 3 轮并打印 cache_write/cache_read
WORKER_URL="https://<worker>" DEBUG_API_KEY="<DEBUG_API_KEY>" npm run cache:test

# 纯记忆库 MCP：列工具
curl "https://<worker>/mcp?token=<MEMORY_MCP_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 纯记忆库 MCP：搜记忆
curl "https://<worker>/mcp?token=<MEMORY_MCP_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_search","arguments":{"query":"用户偏好","top_k":5}}}'

# 无记忆导盲犬 API：不写入记忆、不搜索记忆
curl "https://<worker>/v1/guide-dog/chat/completions" \
  -H "Authorization: Bearer <GUIDE_DOG_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"model":"companion","stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"请描述这张图。"},{"type":"image_url","image_url":{"url":"https://dummyimage.com/160x80/00ff00/000000.png&text=GREEN"}}]}],"max_tokens":80}'
```
