# Aelios：给 AI 用的长期记忆网关

Aelios 是一个跑在 Cloudflare Workers 上的 AI 记忆系统。你把 Chatbox、Cherry Studio、网页前端、IM bot 或自己的脚本接到它，它就可以一边转发聊天，一边把重要信息整理成长期记忆。

简单说：**它让任何 AI 都能长期记住你的偏好、规则、关系事实、项目背景和重要原文。** 不只是这一轮聊天记得你，而是换窗口、换客户端、换模型之后，记忆也能跟着走。

它默认用 Cloudflare 这一套免费/低成本基础设施：

- **Worker**：提供 OpenAI-compatible API，可以直接接常见客户端。
- **D1**：临时保存最近聊天，默认给每日小秘书整理用。
- **Vectorize**：保存真正的长期记忆，支持语义搜索。
- **Workers AI / AI Gateway**：调用聊天模型、embedding、小秘书模型。
- **管理面板**：浏览器打开就能搜索、编辑、删除、重建记忆。

这个仓库有三种入口。**普通用户先用完整版就行**：

1. **完整版**：聊天网关 + 记忆注入 + 每日小秘书整理 + Claude cache。任何支持 OpenAI API 的客户端，基本只要换 `base_url` 就能用。
2. **纯记忆库 MCP**：只把记忆库暴露成 MCP 工具，给 Claude、Codex、MCP 客户端调用。官方客户端也能拥有跨设备、跨窗口、跨应用的随身记忆。
3. **无记忆导盲犬 API**：针对部分纯文本 LLM，前置新增一个看图模型转述图片内容。不保存消息，不搜索记忆，不碰 D1。

完整版能做这些事：

- `/v1/chat/completions`：像 OpenAI API 一样聊天。
- 自动长期记忆注入：每轮聊天前从 Vectorize 找相关记忆。
- 记忆处理：搜索后由 reranker 重排，压缩模型只负责把选中的记忆压短，再塞回上下文。
- 每日整理：原始聊天先存 D1，凌晨统一整理成摘要、重要原文和少量长期记忆。
- Claude prompt cache：尽量复用稳定上下文，降低重复输入成本。
- 图片自动走视觉模型。
- D1 自动清理过期数据。

常用入口：

- `/admin` 或 `/memory-admin`：记忆管理面板。
- `/mcp`：纯记忆库 MCP。
- `/v1/guide-dog/chat/completions`：无记忆导盲犬 API。

---

## 人类版：有手就行的图文部署教程

你不用看代码。照着点就能先跑起一个最小记忆库；想把它接成完整聊天网关，再多填两个 AI Gateway 变量就行。

这份教程分两档：

1. **最小记忆库可用版**：可以写入、搜索、编辑、删除长期记忆；默认 embedding、reranker 和记忆压缩都走 Cloudflare Workers AI。
2. **完整版聊天网关**：可以接 Chatbox、Cherry Studio、网页前端、IM bot 等 OpenAI-compatible 客户端，让聊天自动注入记忆。

### 第一步：Fork 项目

打开项目地址：

[https://github.com/wusaki0723/Aelios](https://github.com/wusaki0723/Aelios)

点击右上角：

```
Fork -> Create fork
```

仓库名可以改，也可以不改。
如果你特别在意隐私，可以在仓库 Settings 里把 fork 改成 private。

不用太担心 GitHub 仓库本身，因为你的聊天内容和记忆不会存在 GitHub 里，它们会存在你自己的 Cloudflare D1 和 Vectorize 里。

### 第二步：在 Cloudflare 创建 Worker

打开 Cloudflare Dashboard，进入：

```
Workers & Pages
-> Create application
```

![进入 Workers and Pages](docs/assets/tutorial/cloudflare-workers-create-application.png)

选择连接 GitHub，然后选中你刚刚 fork 的 Aelios 仓库。

![选择 Aelios 仓库](docs/assets/tutorial/cloudflare-select-aelios-repository.png)

中间如果出现授权、连接 GitHub、选择仓库之类的页面，保持默认即可。

### 第三步：填写部署配置

Cloudflare 会让你填写项目配置。照下面这样填：

```
Project name:       companion-memory-proxy
Production branch:  main
Root directory:     /
Build command:      npm ci
Deploy command:     npm run deploy:cloudflare
```

**Deploy command 一定要填 `npm run deploy:cloudflare`。**

不要填成 `npm run deploy`，也不要填成 `wrangler deploy`。
这个命令会自动帮你创建和升级 D1、Vectorize、Queue，然后再部署 Worker。

填完之后点 Deploy。

### 第四步：添加最小必填变量

第一次部署可能会因为缺环境变量失败，这是正常的。
进入你刚刚创建的 Worker 项目：

```
Settings
-> Variables and Secrets
-> Add variable
```

![添加环境变量](docs/assets/tutorial/cloudflare-variables-chatbox-key.png)

最小记忆库模式需要填这几个：

| 变量名 | 填什么 | 用来干嘛 |
|--------|--------|----------|
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare Account ID | 创建和管理 D1 / Vectorize / Queue |
| `CLOUDFLARE_API_TOKEN` | 你的 Cloudflare API Token | 让部署脚本和 Worker 管理 Vectorize |
| `CHATBOX_API_KEY` | 你自己编一个密码，例如 `sk-my-memory-key` | 以后访问这个 Worker 用 |

`CHATBOX_API_KEY` 可以随便写一个你喜欢的，只要自己记住就行。
比如：

```
sk-testapi
sk-my-aelios-key
sk-something-only-i-know
```

保存变量后，回到 Deployments 里重新部署一次。

部署成功后，你会得到一个 Worker 地址，大概长这样：

```
https://companion-memory-proxy.<你的子域>.workers.dev
```

到这里，**记忆库功能其实已经能用了**。

因为默认的 embedding、记忆 reranker 和记忆压缩小秘书都走 Cloudflare Workers AI：

```
EMBEDDING_MODEL = workers-ai/@cf/google/embeddinggemma-300m
MEMORY_RERANKER_MODEL = workers-ai/@cf/baai/bge-reranker-base
MEMORY_FILTER_MODEL = workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

所以即使你还没配置 AI Gateway，也可以写入、搜索、编辑、删除长期记忆。

### 第五步：检查记忆库是否可用

打开浏览器访问：

```
https://<你的 Worker 地址>/health
```

如果你还没有配置 AI Gateway，可能会看到它提示缺：

```
AI_GATEWAY_BASE_URL
CF_AIG_TOKEN
```

这不代表记忆库坏了。
这只代表“完整版聊天代理”还没配置好。

最小记忆库可用时，你至少应该已经有：

```
D1: true
Vectorize: true
Queue: true
```

也可以打开管理面板：

```
https://<你的 Worker 地址>/admin
```

或者：

```
https://<你的 Worker 地址>/memory-admin
```

第一次打开时填：

```
Worker URL:  https://<你的 Worker 地址>
API Key:     你刚刚设置的 CHATBOX_API_KEY
```

这个面板可以用来搜索、查看、新增、编辑、删除你的长期记忆。

### 第六步：配置 AI Gateway

如果你只想先用记忆库，可以跳过这一步。
如果你想让 Aelios 也能当聊天网关用，就继续配置 AI Gateway。

在 Cloudflare 左侧找到：

```
AI
-> AI Gateway
-> Create a custom gateway
```

![创建 AI Gateway](docs/assets/tutorial/cloudflare-ai-gateway-create.png)

创建成功后，页面上会有一个 `Your Gateway Endpoint`。
把这个地址保存下来，后面要填进 Worker 环境变量里。

接着进入 `Provider Keys`，添加你已有的模型 API key。
可以添加官方 provider，也可以添加第三方自定义 provider。

![配置 Provider Keys](docs/assets/tutorial/cloudflare-ai-gateway-provider-keys.png)

### 第七步：给 Worker 添加 AI Gateway 变量

回到刚刚部署好的 Worker：

```
Settings
-> Variables and Secrets
-> Add variable
```

添加：

| 变量名 | 填什么 |
|--------|--------|
| `AI_GATEWAY_BASE_URL` | 刚刚复制的 Gateway Endpoint |
| `CF_AIG_TOKEN` | Cloudflare AI Gateway 的调用 token |

保存后重新部署。

这一步完成后，完整版聊天网关也可以用了。

### 第八步：客户端怎么填

以 Chatbox 为例：

```
Base URL:   https://<你的 Worker 地址>/v1
API Key:    你设置的 CHATBOX_API_KEY
Model:      companion
```

然后你可以试着说：

```
请记住：我的测试暗号是苹果星星-0428。
```

过一会儿再问：

```
我的测试暗号是什么？
```

如果能答出来，就说明记忆链路已经跑通了。

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

### 所有环境变量速查表

**最小记忆库必填：**

| 变量名 | 说明 |
|--------|------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，用于 setup、Vectorize list/get/delete |
| `CHATBOX_API_KEY` | 客户端和管理面板连接密码 |

只用记忆库时，默认 embedding、reranker 和记忆压缩都走 Workers AI，不需要先配置 AI Gateway。

**完整版聊天网关再填：**

| 变量名 | 说明 |
|--------|------|
| `AI_GATEWAY_BASE_URL` | Cloudflare AI Gateway 地址 |
| `CF_AIG_TOKEN` | AI Gateway 调用用的 token |

**模型（都有默认值，可选改）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CHAT_MODEL` | `deepseek/deepseek-v4-pro` | 主聊天 |
| `MEMORY_RERANKER_MODEL` | `workers-ai/@cf/baai/bge-reranker-base` | 向量召回后的 reranker，负责按当前消息重排候选记忆 |
| `ENABLE_MEMORY_RERANKER` | `true` | 设 `false` 跳过 reranker，直接按向量分数进入压缩 |
| `MEMORY_FILTER_MODEL` | `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 记忆压缩模型，只负责把 reranker 选出的记忆压短 |
| `MEMORY_FILTER_MAX_CANDIDATES` | `12` | 进入 reranker 的候选记忆上限 |
| `MEMORY_FILTER_MAX_OUTPUT` | `5` | reranker 选出并交给压缩模型的记忆上限 |
| `MEMORY_FILTER_OUTPUT_CHARS` | `300` | 压缩模型每条返回内容最多多少字 |
| `MEMORY_FILTER_MAX_TOKENS` | `1400` | 压缩模型 JSON 输出上限，避免多条压缩结果被截断 |
| `DREAM_MODEL` | `deepseek/deepseek-v4-pro` | 后台记忆模型；负责增量抽取、合并判断、长期摘要和夜间 dream |
| `VISION_MODEL` | `google-ai-studio/gemini-3-flash-preview` | 看图；普通聊天和导盲犬 API 都用它 |
| `EMBEDDING_MODEL` | `workers-ai/@cf/google/embeddinggemma-300m` | 向量嵌入，默认走 Workers AI |
| `EMBEDDING_DIMENSIONS` | `768` | 非 Workers AI embedding 请求的目标维度 |

**Claude 专属（可选）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ANTHROPIC_THINKING_ENABLED` | `false` | 开启 Claude 深度思考 |
| `ANTHROPIC_THINKING_BUDGET` | `1024` | 思考 token 预算（1024-32000） |
| `ANTHROPIC_CACHE_TTL` | `5m` | Prompt cache 时长（`5m` 或 `1h`） |
| `ANTHROPIC_CACHE_ENABLED` | `true` | 设 `false` 关闭 cache |
| `ANTHROPIC_AUTO_CACHE_ENABLED` | `false` | 设 `true` 才开启 Anthropic 顶层 automatic cache。默认关闭，避免历史前缀变化时反复重建缓存 |
| `ANTHROPIC_ROLLING_CACHE_ENABLED` | `true` | 显式滚动 cache 打点。未满窗口时打在最后一条 user；达到窗口上限后打在当前窗口第一条 user。设 `false` 可关闭 |
| `ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE` | `20` | 前端保留的历史窗口大小。Chatbox 日志里 `historyCount=20` 时可保持默认 |
| `FORCE_ANTHROPIC_NATIVE` | 空 | 设 `true` 强制所有模型走 Anthropic native |
| `CUSTOM_ANTHROPIC_MESSAGES_PATH` | `messages` | custom Claude 的原生 messages 路径 |

**高级（一般不用动）：**

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `IM_API_KEY` | 空 | 第二把钥匙（IM bot 用） |
| `DEBUG_API_KEY` | 空 | 调试接口钥匙 |
| `MEMORY_TOP_K` | `50` | 向量粗召回条数；默认多召回，再由 reranker 缩减到 `MEMORY_FILTER_MAX_OUTPUT` |
| `MEMORY_MIN_SCORE` | `0.35` | 记忆搜索最低相关度 |
| `MEMORY_FILTER_MIN_SCORE` | `0.35` | 进入 reranker 前的最低向量相关度；不填时跟随 `MEMORY_MIN_SCORE` |
| `MEMORY_FILTER_MAX_CONTENT_CHARS` | `700` | 交给 reranker/压缩模型前，每条候选最多保留多少字 |
| `MEMORY_MIN_IMPORTANCE` | `0.55` | 记忆写入最低重要性 |
| `MEMORY_BACKEND` | `vectorize` | 长期记忆主库。默认 Vectorize；设 `d1` 可回到旧模式 |
| `VECTORIZE_INDEX_NAME` | `memo-kb` | Vectorize 索引名，给 list-vectors API 使用 |
| `ENABLE_AUTO_MEMORY` | 空（开启） | 设 `false` 关闭自动记忆 |
| `ENABLE_INCREMENTAL_MEMORY` | `false` | 设 `true` 才恢复每轮聊天后即时抽取 |
| `ENABLE_DREAM` | `true` | 夜间 dream 开关 |
| `DREAM_TIME_ZONE` | `Asia/Singapore` | dream 按这个时区切自然日；默认每天凌晨处理昨天 |
| `DREAM_MAX_MESSAGES` | `40` | 每次 dream 最多处理的原始消息数；当天太长会分批继续 |
| `DREAM_MAX_RUNS` | `10` | 每次定时任务最多连续 dream 几批，防止单次模型输入太大 |
| `DREAM_MAX_TOKENS` | `8000` | dream 模型最多输出 token |
| `DREAM_MEMORY_CONTEXT_LIMIT` | `40` | dream 时提供给模型参考的旧记忆数量 |
| `DREAM_EXCERPT_LIMIT` | `8` | dream 每天最多保存的重要原文段落 |
| `ENABLE_DAILY_SUMMARY_MEMORY` | `false` | 设 `true` 才把每日摘要也写入 Vectorize；默认只留在 D1 |
| `EMPTY_MEMORY_MIN_CHARS` | `4` | 每日整理时清理短空记忆的阈值 |
| `PUBLIC_MODEL_NAME` | `companion` | 客户端看到的模型名 |
| `MEMORY_MCP_API_KEY` | 空 | 纯记忆库 MCP 的单独钥匙 |
| `GUIDE_DOG_API_KEY` | 空 | 无记忆导盲犬 API 的单独钥匙 |

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
GET    /admin
GET    /memory-admin
GET    /v1/models
POST   /v1/chat/completions
POST   /v1/guide-dog/chat/completions
POST   /guide-dog/v1/chat/completions
GET    /mcp
POST   /mcp
GET    /v1/memories
POST   /v1/memories
POST   /v1/memories/search
POST   /v1/memories/digest
POST   /v1/memories/ingest
GET    /v1/memories/:id
PATCH  /v1/memories/:id
DELETE /v1/memories/:id
GET    /v1/memory
POST   /v1/memory
POST   /v1/memory/search
POST   /v1/memory/digest
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

默认走 Vectorize 搜索，再用 reranker 重排，最后让记忆压缩小秘书只负责压缩。想要最低延迟时传 `filter: false`，只返回原始向量命中；想直接拿一段可塞进 prompt 的文本时传 `include_prompt: true`。

简单说：`/v1/memory/search` 是给模型召回用的，可能被小秘书加工；`/v1/memory/:id` 和列表/创建/修改/删除是给人或脚本管理原始记忆库用的。

也可以打开轻量管理面板：

```
https://<worker>/admin
https://<worker>/memory-admin
```

面板在浏览器里保存 Worker URL 和 API key，只作为本地管理工具使用。它调用同一套 REST API，可以搜索、列表、创建、编辑、删除 Vectorize 长期记忆，也可以运行 `vector_health` 和按页 `vector_reindex`。

如果旧 Vectorize 里已经有很多长块、多主题块、重复总结，可以让 LLM 先生成清洗计划：

```bash
AELIOS_BASE_URL="https://<worker>" \
AELIOS_API_KEY="<CHATBOX_API_KEY>" \
AI_GATEWAY_BASE_URL="<AI Gateway Endpoint>" \
CF_AIG_TOKEN="<AI Gateway Token>" \
CLEANUP_MODEL="deepseek/deepseek-v4-flash" \
npm run vectorize:clean:llm
```

如果只是临时清库，也可以不走 Cloudflare AI Gateway，直接走任意 OpenAI-compatible API：

```bash
AELIOS_BASE_URL="https://<worker>" \
AELIOS_API_KEY="<CHATBOX_API_KEY>" \
CLEANUP_OPENAI_BASE_URL="https://<openai-compatible-host>/v1" \
CLEANUP_API_KEY="<model api key>" \
CLEANUP_MODEL="mimo-v2.5-pro" \
npm run vectorize:clean:llm
```

这个命令默认只会导出备份和计划到 `backups/`，不会改动线上记忆库。确认计划没问题后，再执行：

```bash
npm run vectorize:clean:llm -- --apply-plan backups/llm-clean-vectorize-plan-<时间>.json
```

常用调试参数：

```bash
npm run vectorize:clean:llm -- --limit-batches 1
CLEANUP_MIN_CHARS=700 npm run vectorize:clean:llm
CLEANUP_BATCH_SIZE=3 npm run vectorize:clean:llm
CLEANUP_CONCURRENCY=4 npm run vectorize:clean:llm
CLEANUP_SCOPE=all CLEANUP_CONCURRENCY=4 npm run vectorize:clean:llm
```

`backups/` 已在 `.gitignore` 里，不会被提交。它会包含原始记忆内容，用完可以删除。

清洗计划会把稳定事实、偏好、关系规则整理成短记忆；如果旧块里本来就带有原对话小段，会另存为 `type: "excerpt"` 原文 chunk，并带 `original-dialogue` 标签，和普通总结记忆分开检索、分开管理。原文前缀使用 `咲咲/旦九对话原文：`、`咲咲原话：` 或 `旦九原话：`。

手动补跑 dream：

```bash
curl "https://<worker>/v1/memory/dream" \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"dates":["2026-05-16","2026-05-17"],"max_runs":3}'

# 旧 digest 路径仍兼容
curl "https://<worker>/v1/memory/digest" \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"dates":["2026-05-16","2026-05-17"],"max_runs":3}'
```

不传 `dates` 时默认整理昨天；`force:true` 会忽略当天已完成游标，只有确认要重跑时再用。

**3. 无记忆导盲犬 API**

```
POST /v1/guide-dog/chat/completions
POST /guide-dog/v1/chat/completions
```

只做 OpenAI-compatible 转发，看图时使用 `VISION_MODEL`，否则使用 `CHAT_MODEL`。它不会保存消息，不会注入记忆，不会触发 Queue，适合单独做“看图描述/识别/辅助导航”。

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
Embedding:   workers-ai/@cf/google/embeddinggemma-300m
Dimensions:  768 (如覆盖 EMBEDDING_MODEL，输出维度仍需匹配)
```

### 模型路由

聊天和非 Workers AI 模型调用走 Cloudflare AI Gateway。`workers-ai/`、`worker/`、`@cf/` 前缀的 embedding、reranker 和压缩模型会直接走 Worker 的 Workers AI binding。

```
用户传 model=companion
  -> resolveTargetModel -> CHAT_MODEL

请求含 image_url/input_image
  -> VISION_MODEL

目标模型名含 anthropic 或 claude
  -> Anthropic native: <AI_GATEWAY_BASE_URL>/anthropic/v1/messages
  -> 显式 cache_control on client_system block 负责缓存稳定 system 前缀
  -> dynamic_memory_patch 会后移到当前 user 内容块，不进入历史缓存前缀
  -> rolling user cache_control 默认开启，automatic cache_control 默认关闭
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

组装顺序（10 个 block，单一线性）：

```
system_blocks:
  1. proxy_static_rules    (stable)  — 不暴露后端的规则
  2. persona_pinned        (stable)  — identity/persona 记忆
  3. long_term_summary     (stable)  — 长期对话摘要（≤2000字）
  4. preset_lite           (stable)  — 输出风格指令
  5. client_system         (stable)  — 前端 system 消息，已拆出明显时间变量 [CACHE ANCHOR]
  6. client_volatile_context (dynamic) — 前端 system 里的当前日期/时间等本轮变量
  7. dynamic_memory_patch  (dynamic) — RAG 命中的记忆
  8. vision_context        (dynamic) — 视觉描述

messages:
  9. recent_history        — 历史消息（仅 user/assistant）
 10. current_user          — 当前用户消息（保留原始 content，图片不丢）
```

前端如果把 `Current date: ...`、`当前时间：...` 这类每轮都会变化的内容塞在 system 顶部，assembler 会把这些行拆到 `client_volatile_context`。它仍然会发给模型，但会排在 `client_system` 的显式 cache anchor 后面，避免单个时间变量把稳定角色卡和规则缓存全部打穿。

默认使用两层 Claude prompt cache：

- 显式 `cache_control`：仍然落在 client_system（block 5），保证前面的 stable blocks 有独立缓存。
- 滚动显式 `cache_control`：默认开启。未满历史窗口时落在最后一条 user 内容上；达到 `ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE` 后，改落在当前窗口第一条 user 内容上，相当于满 20 条后从头重新建缓存段。
- 顶层 automatic `cache_control`：默认关闭。设 `ANTHROPIC_AUTO_CACHE_ENABLED=true` 后才启用。

动态记忆 `dynamic_memory_patch` 在 assembler 里仍是独立 block；走 Anthropic native 时，会从 `system` 里摘出来，追加到当前 user 内容块末尾。这样 Claude 能看到本轮召回的记忆，但它不会出现在 system cache 或历史 rolling cache 的前缀里。

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
  -> MEMORY_RERANKER_MODEL 重排候选
  -> MEMORY_FILTER_MODEL 用 JSON mode 压缩 reranker 选中的记忆
  -> 注入 dynamic_memory_patch
  -> pinned identity/persona -> persona_pinned block
```

**聊天后（维护）：**

```
保存 user/assistant messages 到 D1
  -> 默认不即时写入长期记忆
  -> 每天 04:10（Asia/Singapore）触发 scheduled dream
    -> 只读取昨天这个自然日的原始聊天
    -> 如果当天聊天太多，就按 DREAM_MAX_MESSAGES 分批处理，最多连续跑 DREAM_MAX_RUNS 批
    -> 读取一批 Vectorize 旧 active 记忆作为参考
    -> 清理空/过短记忆
    -> DREAM_MODEL 生成固定格式 dream 摘要
    -> 日摘要默认只保存到 D1；important excerpt 可进入 Vectorize
    -> 新增少量高质量长期记忆
    -> 合并重复、替换过时、更新/删除冲突旧记忆
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
