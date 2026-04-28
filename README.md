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
- 聊天请求会自动注入长期记忆
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
Deploy command: npm run setup:cloudflare && npx wrangler deploy --keep-vars
```

在 Cloudflare 的构建配置里，找到 `Variables and Secrets`。

模型变量会从 `wrangler.toml` 自动出现在 Cloudflare 里，而且很直观，方便你随时看见和修改：

```text
CHAT_MODEL                主聊天模型，默认 deepseek/deepseek-v4-pro
MEMORY_FILTER_MODEL       记忆压缩分拣模型，默认 openai/gpt-4.1-mini
MEMORY_MODEL              记忆小秘书模型，默认 deepseek/deepseek-v4-flash
VISION_MODEL              导盲犬视觉模型，默认 openai/gpt-4.1-mini
```

你只需要自己新增这 3 个 Text：

```text
AI_GATEWAY_BASE_URL       普通变量，可以填到 gateway id 或 /compat 结尾
CHATBOX_API_KEY           Text，自己编一个 sk-xxx
CF_AIG_TOKEN              Text，你的 Cloudflare AI Gateway token
```

四个模型名分别是：

```text
CHAT_MODEL           平时聊天用的大模型
MEMORY_FILTER_MODEL  压缩、分拣记忆的小模型
MEMORY_MODEL         聊天结束后整理长期记忆的小秘书
VISION_MODEL         以后处理图片/视觉输入的导盲犬
```

如果模型变量没有出现，点一次重新 Deploy。私有变量不会写在仓库里，所以 `AI_GATEWAY_BASE_URL`、`CHATBOX_API_KEY`、`CF_AIG_TOKEN` 需要你自己加。
项目已经在 `wrangler.toml` 里设置了 `keep_vars = true`，避免重新部署时清掉你在 Cloudflare Dashboard 手动填的私有变量。

向量模型不用填，固定默认 `@cf/google/embeddinggemma-300m`，Vectorize 维度按 768。
其他开关不用填：Claude 自动路由、Claude cache_control、记忆注入、记忆抽取、Cache API 都自动开。

填完后点 Deploy。以后你只要 push GitHub，Cloudflare 会自动部署。

## 备用：手动部署命令

Build command:

```bash
npm install
```

Deploy command：

```bash
npm run setup:cloudflare && npx wrangler deploy --name 你的项目名 --keep-vars
```

`setup:cloudflare` 会自动做这些事：

- 创建或查找 D1：`companion_memory_proxy`
- 自动把 D1 的 `database_id` 写进 `wrangler.toml`
- 执行 D1 migrations 建表
- 创建或复用 Vectorize：`memo-kb`
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

## 要填的 Text 变量

Cloudflare 里会有 4 个模型 Text，你只需要另外填 3 个私有 Text：

```text
AI_GATEWAY_BASE_URL
CHATBOX_API_KEY
CF_AIG_TOKEN
```

模型 Text 默认在 `wrangler.toml`，也会显示在 Cloudflare 里：

```text
CHAT_MODEL
MEMORY_FILTER_MODEL
MEMORY_MODEL
VISION_MODEL
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
CHAT_MODEL=deepseek/deepseek-v4-pro
MEMORY_FILTER_MODEL=openai/gpt-4.1-mini
MEMORY_MODEL=deepseek/deepseek-v4-flash
VISION_MODEL=openai/gpt-4.1-mini
```

主模型、小模型分拣、记忆小秘书、导盲犬模型都从 Worker 调 Cloudflare AI Gateway；Worker 不直接调用 OpenAI/Anthropic key，也不直接调用 Workers AI 模型。

路由规则：

```text
模型名包含 anthropic 或 claude -> Anthropic native endpoint + cache_control
其他模型名                    -> Cloudflare AI Gateway OpenAI-compatible endpoint
```

Claude 路径会跳过 Cloudflare 整轮 response cache，并使用 Anthropic prompt cache：

```text
这些不用你填，系统默认开启。
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

默认流程：

```text
根据最后一条用户消息搜索相关记忆
  -> 置顶记忆优先
  -> 相关记忆补充
  -> 生成一小段 memory patch 给聊天模型
```

注入前会用 `MEMORY_FILTER_MODEL` 做筛选/压缩：

```text
Vectorize/D1 召回候选记忆
  -> MEMORY_FILTER_MODEL 判断相关性并压缩
  -> 主模型只收到筛过的 memory patch
```

这些筛选开关不用你填，系统有默认值。

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

Cache API 默认开启，不用填额外开关。

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

自动记忆默认开启，不用填额外开关。你只需要填 `MEMORY_MODEL`。
