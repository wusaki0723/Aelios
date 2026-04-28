# Companion Memory Proxy

这是一个部署在 Cloudflare Workers 上的 OpenAI-compatible 记忆网关。

它让 Chatbox、Cherry Studio、网页前端、IM bot 这类支持 OpenAI API 的客户端，直接获得：

- 普通 `/v1/chat/completions` 聊天接口
- 自动长期记忆注入
- 自动写入长期记忆
- 手动 Memory API
- Vectorize 语义搜索
- Cloudflare AI Gateway 统一模型调用
- Claude 自动路由和显式 prompt cache
- 图片请求自动走视觉模型
- Cache API

---

## 人类版：极简部署

你不用看懂代码。照着做，卡住就把本仓库链接发给你的 AI，让它照下面的“AI 版”部署。

### 1. 先准备

你需要：

```text
一个 Cloudflare 账号
一个 Cloudflare AI Gateway
一个 GitHub 仓库
```

如果你不想自己操作，就复制这句话给你的 AI：

```text
请帮我部署这个 GitHub 仓库到 Cloudflare Workers。README 里有人类版和 AI 版说明，请按 AI 版操作。部署后帮我测试 /health、图片请求、记忆写入和记忆搜索。
```

仓库地址：

```text
https://github.com/wusaki0723/Aelios
```

### 2. 在 Cloudflare 关联 GitHub

在 Cloudflare 里点：

```text
Workers & Pages
-> Create application
-> Import a repository
-> 选择 GitHub
-> 选择 wusaki0723/Aelios
```

项目配置填：

```text
Project name: companion-memory-proxy
Production branch: main
Root directory: /
Build command: npm ci
Deploy command: npm run deploy:cloudflare
```

### 3. 填变量

在 Cloudflare 项目的 `Variables and Secrets` 里填这些。

必须填的私有信息：

```text
AI_GATEWAY_BASE_URL     你的 Cloudflare AI Gateway 地址
CHATBOX_API_KEY         你自己编一个，例如 sk-xxxx
CF_AIG_TOKEN            你的 Cloudflare AI Gateway token
```

模型旋钮，也可以直接在 Cloudflare 里改：

```text
CHAT_MODEL              主聊天模型
MEMORY_FILTER_MODEL     记忆筛选压缩模型
MEMORY_MODEL            记忆小秘书模型
VISION_MODEL            图片识别模型
```

仓库默认值是：

```text
CHAT_MODEL=deepseek/deepseek-v4-pro
MEMORY_FILTER_MODEL=google-ai-studio/gemini-2.5-flash
MEMORY_MODEL=deepseek/deepseek-v4-flash
VISION_MODEL=google-ai-studio/gemini-3-flash-preview
```

如果部署时提示 Wrangler 没权限，再补两个构建变量：

```text
CLOUDFLARE_API_TOKEN    能部署 Worker、管理 D1、Vectorize、Queues 的 Cloudflare token
CLOUDFLARE_ACCOUNT_ID   你的 Cloudflare account id
```

### 4. 点 Deploy

部署成功后，你的地址大概长这样：

```text
https://companion-memory-proxy.<你的子域>.workers.dev
```

### 5. Chatbox 这样填

```text
Base URL: https://<你的 Worker 地址>/v1
API Key:  CHATBOX_API_KEY 里填的那个
Model:    companion
```

### 6. 怎么知道成功了

打开：

```text
https://<你的 Worker 地址>/health
```

如果看到 `ok: true`，第一关过了。

然后在 Chatbox 里说：

```text
请记住：我的测试口令是苹果星星-0428。
```

过十几秒再问：

```text
我的测试口令是什么？
```

能答出来，就部署好了。

### 7. 最容易踩的坑

```text
看图很贵：确认 VISION_MODEL 是你想用的模型。
主聊天很贵：确认 CHAT_MODEL 是你想用的模型。
重新部署后变量消失：Deploy command 必须带 npm run deploy:cloudflare，里面已经带 --keep-vars。
Vectorize 不要乱删：默认用 memo-kb，768 维。
```

---

## AI 版：详细交接说明

这一节是给 Codex、Claude Code、Cursor、ChatGPT、Gemini CLI 等 AI 看的。人类不需要硬啃。

### 项目定位

本项目是 Cloudflare Workers 上的 OpenAI-compatible Memory Proxy。

对外接口：

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
GET  /v1/memories
POST /v1/memories
POST /v1/memories/search
POST /v1/memories/ingest
PATCH /v1/memories/:id
DELETE /v1/memories/:id
GET/PUT/DELETE /v1/cache/:namespace/:key
```

核心原则：

```text
前端负责角色卡、聊天风格、工具、网页搜索、当前上下文。
Worker 负责统一 API、记忆注入、记忆写入、Claude cache、Cloudflare AI Gateway 代理。
```

### 当前资源约定

```text
Worker name: companion-memory-proxy
D1 database: companion_memory_proxy
Vectorize binding: VECTORIZE
Vectorize index: memo-kb
Vectorize dimensions: 768
Vectorize metric: cosine
Queue name: companion-memory
Public model alias: companion
```

向量模型固定在代码里：

```text
workers-ai/@cf/google/embeddinggemma-300m
```

不要把向量模型做成普通用户必填变量。它必须和 Vectorize 维度保持一致。

### 本地命令

```bash
npm ci
npm run typecheck
npm run setup:cloudflare
npm run deploy:cloudflare
```

`npm run deploy:cloudflare` 等价于：

```bash
npm run setup:cloudflare && wrangler deploy --keep-vars
```

`--keep-vars` 必须保留，避免 Cloudflare Dashboard 里的模型变量和私有变量被重新部署覆盖。

### setup 脚本会做什么

`scripts/setup-cloudflare.mjs` 会尽量自动完成：

```text
1. 创建或查找 D1：companion_memory_proxy
2. 把 D1 database_id 写入 wrangler.toml
3. 执行 D1 migrations
4. 创建或复用 Vectorize：memo-kb
5. 创建 Vectorize metadata indexes：namespace、status、type、pinned
6. 创建或复用 Queue：companion-memory
7. 从构建环境同步可见变量到 wrangler.toml
```

如果在 CI 或 Cloudflare 构建环境里失败，优先检查：

```text
CLOUDFLARE_API_TOKEN 是否存在
CLOUDFLARE_ACCOUNT_ID 是否存在
token 是否有 Workers Scripts、D1、Vectorize、Queues 权限
```

### Worker 变量

仓库里保留可见模型旋钮：

```toml
PUBLIC_MODEL_NAME = "companion"
CHAT_MODEL = "deepseek/deepseek-v4-pro"
MEMORY_FILTER_MODEL = "google-ai-studio/gemini-2.5-flash"
MEMORY_MODEL = "deepseek/deepseek-v4-flash"
VISION_MODEL = "google-ai-studio/gemini-3-flash-preview"
```

Cloudflare Dashboard 里还需要填：

```text
AI_GATEWAY_BASE_URL
CHATBOX_API_KEY
CF_AIG_TOKEN
```

可选：

```text
IM_API_KEY
DEBUG_API_KEY
MEMORY_TOP_K
MEMORY_MIN_SCORE
MEMORY_MIN_IMPORTANCE
ANTHROPIC_CACHE_TTL
CACHE_DEFAULT_TTL_SECONDS
CACHE_MAX_VALUE_BYTES
```

### 模型路由

所有模型调用都走 Cloudflare AI Gateway。

```text
用户传 model=companion
  -> CHAT_MODEL

请求里包含 image_url/input_image
  -> VISION_MODEL

目标模型名包含 anthropic 或 claude
  -> Anthropic provider-native endpoint
  -> 显式 cache_control
  -> cf-aig-skip-cache: true

其他模型
  -> /compat/chat/completions
```

OpenAI-compatible 端点：

```text
<AI_GATEWAY_BASE_URL>/compat/chat/completions
```

Anthropic native 端点：

```text
<AI_GATEWAY_BASE_URL>/anthropic/v1/messages
```

Embeddings 端点：

```text
<AI_GATEWAY_BASE_URL>/compat/embeddings
model=workers-ai/@cf/google/embeddinggemma-300m
```

### 记忆注入流程

```text
chat request
  -> 保存 user messages
  -> 提取最后一条用户文本
  -> Vectorize 搜索相关记忆
  -> 若 Vectorize 老 metadata 无 D1 ref，则使用 legacy metadata fallback
  -> MEMORY_FILTER_MODEL 分拣压缩
  -> 注入 system memory patch
  -> 转发上游模型
  -> 保存 assistant message 和 usage
  -> 后台触发记忆维护
```

图片请求只取文本部分做记忆搜索，不把 data URL 或图片 URL 扔进 embedding。

### 自动写记忆流程

当前实现为了避免 Cloudflare Queue/`waitUntil` 调慢模型超时，对明确记忆做快速兜底：

```text
chat/ingest 完成
  -> 保存 messages
  -> 后台 runMemoryMaintenance
  -> 如果用户消息明确包含“记住 / 长期偏好 / 稳定偏好 / 口令是”等
       直接写入一条 explicit-memory
     否则
       调 MEMORY_MODEL 抽取 JSON
  -> importance/confidence 过滤
  -> 重复检查
  -> D1 memories
  -> Vectorize upsert
```

注意：

```text
Queue binding 和 consumer 还保留，但 producer 当前直接调用 handleQueueMessage。
原因是线上测试时 Queue/waitUntil 组合容易静默或超时。
后续如果要恢复真正 Queue，需要重新做端到端验证。
```

### Cache API

Cache API 用 D1 存小型 JSON 或文本。适合前端缓存：

```text
网页摘要
搜索结果
工具结果
上下文包
```

不适合缓存：

```text
API key
未脱敏凭证
特别大的二进制
完整私密聊天原文
```

### 手工验收命令

健康检查：

```bash
curl "https://<worker>/health"
```

模型列表：

```bash
curl "https://<worker>/v1/models" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>"
```

图片模型测试：

```bash
curl "https://<worker>/v1/chat/completions" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "model": "companion",
    "stream": false,
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "这张图里最大的英文单词是什么？只回答那个单词。" },
          { "type": "image_url", "image_url": { "url": "https://dummyimage.com/160x80/00ff00/000000.png&text=GREEN" } }
        ]
      }
    ],
    "max_tokens": 80
  }'
```

自动写记忆测试：

```bash
curl "https://<worker>/v1/chat/completions" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "model": "companion",
    "stream": false,
    "messages": [
      { "role": "user", "content": "请记住：我的自动记忆测试口令是蓝莓星线-0428。" }
    ],
    "max_tokens": 80
  }'
```

搜索记忆：

```bash
curl "https://<worker>/v1/memories/search" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{ "query": "蓝莓星线-0428", "top_k": 5 }'
```

### 当前已验证

截至 2026-04-28：

```text
/health 正常
/v1/models 正常
文本聊天正常
图片请求正常走 VISION_MODEL
Vectorize 搜索 memo-kb 正常
手动 Memory API 正常
/v1/memories/ingest 自动写入正常
/v1/chat/completions 聊天后自动写入正常
```

### 已知问题和下一步

```text
1. MEMORY_MODEL 慢时可能超过 Cloudflare waitUntil 时间，明确记忆已有快速兜底，普通隐式记忆还需要更稳的异步方案。
2. Queue consumer 保留但当前 producer 绕过 Queue，后续要么恢复 Queue 并验收，要么移除 Queue 配置。
3. 记忆 merge/supersede 还很轻，可能出现多条相似记忆。
4. Claude prompt cache 代码已实现，但还需要真实 Claude 连续多轮验证 cache_read_tokens。
5. 没有管理后台，删除/编辑记忆需要 API。
6. 目前没有完整单元测试套件，主要靠 typecheck 和线上手工验收。
7. AI_GATEWAY_BASE_URL、CHATBOX_API_KEY、CF_AIG_TOKEN 当前按用户要求用 Text 变量，方便看见，但生产环境更建议用 Secret。
```
