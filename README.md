# Companion Memory Proxy

这是一个 Cloudflare Workers 上的 OpenAI-compatible 记忆代理。当前已经完成 M1-M5 骨架：

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions` 非流式 OpenAI-compatible proxy
- `POST /v1/chat/completions` 流式 OpenAI SSE 透传
- `Authorization: Bearer ...` / `x-api-key` 鉴权
- D1 保存用户消息、助手消息和 usage log
- 流式响应会边返回给前端，边累计助手回复，结束后写入 D1
- 记忆 API：手动写入、列出、读取、修改、软删除、搜索
- 聊天请求会按 `INJECTION_MODE` 自动注入长期记忆
- 可用 `MEMORY_FILTER_MODEL` 在注入前筛选、压缩候选记忆
- 自动路由：模型名包含 `anthropic` 或 `claude` 时走 Claude native + 显式 prompt cache，其余走 OpenAI-compatible
- 聊天结束后通过 Queue 自动抽取长期记忆
- Cache API：前端可缓存网页、搜索结果、工具结果、上下文包

## 最简单部署：Cloudflare Worker 关联 GitHub

Cloudflare Workers 可以直接关联 GitHub 仓库。关联后，只要 push 到 `main`，Cloudflare 会自己拉代码、构建、部署。

你按这个点：

```text
Cloudflare Dashboard
-> Workers & Pages
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
Deploy command: npm run setup:cloudflare && npx wrangler deploy
```

在 Cloudflare 这个 Worker 的变量/密钥里填：

```text
AI_GATEWAY_BASE_URL       普通变量
CHATBOX_API_KEY           Secret
CF_AIG_TOKEN              Secret
```

可选：

```text
IM_API_KEY                Secret
DEBUG_API_KEY             Secret
```

填完后点 Deploy。以后你只要 push GitHub，Cloudflare 会自动部署。

## 备用：手动部署命令

Build command:

```bash
npm install
```

Deploy command：

```bash
npm run setup:cloudflare && npx wrangler deploy --name 你的项目名
```

`setup:cloudflare` 会自动做这些事：

- 创建或查找 D1：`companion_memory_proxy`
- 自动把 D1 的 `database_id` 写进 `wrangler.toml`
- 执行 D1 migrations 建表
- 创建或复用 Vectorize：`companion_memories`
- 创建 Vectorize metadata indexes：`namespace`、`status`、`type`、`pinned`
- 确保 Vectorize binding 存在
- 创建或复用 Queue：`companion-memory`

如果你的平台要求先进入项目目录，就写成：

```bash
cd files-mentioned-by-the-user-companion && npm install
```

```bash
cd files-mentioned-by-the-user-companion && npm run setup:cloudflare && npx wrangler deploy --name 你的项目名
```

## Secrets

至少设置一个客户端 key，以及上游所需的 key：
所有模型调用都走 Cloudflare AI Gateway。自定义 provider 请在 AI Gateway 里配置，Worker 只传模型名。

```bash
wrangler secret put CHATBOX_API_KEY
wrangler secret put CF_AIG_TOKEN
```

## Chatbox 配置

```text
Base URL: https://<your-worker>.workers.dev/v1
API Key:  你设置的 CHATBOX_API_KEY
Model:    companion
```

## 模型路由

模型名全部由环境变量控制，代码里不内置固定模型：

```text
PUBLIC_MODEL_NAME=companion
DEFAULT_UPSTREAM_MODEL=anthropic/claude-sonnet-4-5
MEMORY_FILTER_MODEL=openai/gpt-4.1-mini
MEMORY_MODEL=google-ai-studio/gemini-2.5-flash
EMBEDDING_MODEL=@cf/google/embeddinggemma-300m
```

主模型、小模型分拣、embedding 都从 Worker 调 Cloudflare AI Gateway；Worker 不直接调用 OpenAI/Anthropic key，也不直接调用 Workers AI 模型。

路由规则：

```text
模型名包含 anthropic 或 claude -> Anthropic native endpoint + cache_control
其他模型名                    -> Cloudflare AI Gateway OpenAI-compatible endpoint
```

Claude 路径会跳过 Cloudflare 整轮 response cache，并使用 Anthropic prompt cache：

```text
ANTHROPIC_CACHE_ENABLED=true
ANTHROPIC_CACHE_TTL=5m
ANTHROPIC_CACHE_STABLE_SYSTEM=true
```

## Memory API

写一条记忆：

```bash
curl -X POST "https://<your-worker>.workers.dev/v1/memories" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "type": "preference",
    "content": "用户喜欢自然、短句、像 IM 一样的互动。",
    "importance": 0.9,
    "confidence": 1,
    "tags": ["style", "chat"]
  }'
```

搜索记忆：

```bash
curl -X POST "https://<your-worker>.workers.dev/v1/memories/search" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{ "query": "用户喜欢什么聊天风格？", "top_k": 8 }'
```

高级前端也可以显式提交一段对话，让后台抽取记忆：

```bash
curl -X POST "https://<your-worker>.workers.dev/v1/memories/ingest" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "source": "custom_frontend",
    "conversation_id": "default",
    "auto_extract": true,
    "messages": [
      { "role": "user", "content": "我最近在做 Cloudflare Worker 记忆代理。" },
      { "role": "assistant", "content": "我记住啦，你在做一个带长期记忆的网关。" }
    ]
  }'
```

## Memory Injection

普通 Chatbox 不需要主动调用 Memory API。只要 `/v1/memories` 里有 active 记忆，`/v1/chat/completions` 会在请求发给上游模型前自动追加一条 system memory patch。

当前支持：

```text
INJECTION_MODE=rag     根据最后一条用户消息搜索相关记忆
INJECTION_MODE=full    注入 active memories
INJECTION_MODE=hybrid  pinned memories + RAG 相关记忆
INJECTION_MODE=none    不注入
```

注入前的小模型筛选/压缩：

```text
ENABLE_MEMORY_FILTER=true
MEMORY_FILTER_MODEL=openai/gpt-4.1-mini
MEMORY_FILTER_MAX_CANDIDATES=16
MEMORY_FILTER_MAX_OUTPUT=6
```

流程是：

```text
Vectorize/D1 召回候选记忆
  -> MEMORY_FILTER_MODEL 判断相关性并压缩
  -> 主模型只收到筛过的 memory patch
```

## Cache API

写入缓存：

```bash
curl -X PUT "https://<your-worker>.workers.dev/v1/cache/web/example-key" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "value": {
      "title": "文章标题",
      "summary": "前端生成的摘要"
    },
    "ttl_seconds": 86400,
    "tags": ["web", "article"]
  }'
```

读取缓存：

```bash
curl "https://<your-worker>.workers.dev/v1/cache/web/example-key" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>"
```

删除缓存：

```bash
curl -X DELETE "https://<your-worker>.workers.dev/v1/cache/web/example-key" \
  -H "Authorization: Bearer <CHATBOX_API_KEY>"
```

相关配置：

```text
ENABLE_CACHE_API=true
CACHE_DEFAULT_TTL_SECONDS=86400
CACHE_MAX_VALUE_BYTES=262144
```

## Auto Memory

聊天完成后会自动投递 `memory_maintenance` 任务：

```text
保存 user/assistant messages
  -> Queue memory_maintenance
  -> MEMORY_MODEL 通过 Cloudflare AI Gateway 抽取 JSON
  -> importance/confidence 过滤
  -> D1 memories
  -> Vectorize embedding upsert
```

相关配置：

```text
ENABLE_AUTO_MEMORY=true
MEMORY_MODE=external
MEMORY_MODEL=google-ai-studio/gemini-2.5-flash
MEMORY_MIN_IMPORTANCE=0.55
```
