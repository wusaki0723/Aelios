# Aelios：给 AI 装一颗跨窗口的长期记忆大脑

> 换窗口、换客户端、换模型，记忆跟着你走，不跟着聊天记录消失。

Aelios 是一个跑在 Cloudflare Workers 上的长期记忆系统。你把 Chatbox、Cherry Studio、网页前端、IM bot 或自己的脚本接到它，它就能一边转发聊天，一边把重要信息整理成长期记忆。

任何支持 OpenAI API 的客户端，基本只要换 base_url 就能用。下一轮聊天时，Aelios 自动从记忆库召回相关内容，压缩后塞进上下文。你的 AI 终于能记住你的偏好、规则、项目背景和重要原文，不是这一轮记得，是永远记得。

---

## 分支指路：先选对版本再动手

| 分支 | 是什么 | 适合谁 |
|---|---|---|
| `main` | **v1 稳定版**。本 README 描述的就是它。功能齐、跑得稳，不再加新功能，只修必要的坑 | 想要一个部署完就不用管的记忆库 |
| [`memory-v2`](../../tree/memory-v2) | **v2 记忆系统，作者自己线上跑的版本**。六层记忆分层、三档写入（即时 / 每4小时 / 凌晨 dream）、v4 Prompt Assembler（缓存锚点 + 时间戳自动拆分，Claude prompt cache 命中率显著更高）、boot 包 + 召回去重三闸 | 想要更聪明的记忆整理，不怕跟着开发分支走 |
| [`tg-bot`](../../tree/tg-bot) | **memory-v2 + Telegram bot 层**。双子 worker 独立部署、webhook + 队列 debounce 合并连发消息、滚动窗口（50 条折叠成摘要留 10 条）、空行自动分气泡。详见 [docs/telegram-bot.md](../../blob/tg-bot/docs/telegram-bot.md) | 想直接在 Telegram 里和带记忆的 AI 说话 |

v2 **不会**并回 main：main 的用户用得好好的，程序员第一条，能用就别动它。三个分支共享同一套 D1 / Vectorize 资源模型，从 main 换到 v2 只需要把 Cloudflare 构建的 Production branch 改成 `memory-v2`，数据不用迁。tg-bot 是叠在 v2 上的增量，部署方式见其分支文档。

---

## 它解决什么问题

| 痛点 | Aelios 怎么解 |
|---|---|
| 每次开新窗口 AI 就失忆，之前聊的全白费 | 聊天内容自动存 D1，凌晨小秘书整理成长期记忆写入 Vectorize，下次开窗口自动召回 |
| 记忆太多塞爆上下文，模型反而变蠢 | 向量粗召回 → reranker 重排 → 压缩模型只留精华，最终注入上下文的只有几百字 |
| 换了客户端记忆就没了 | 记忆存在你自己的 Cloudflare Vectorize 里，不绑定任何客户端，换客户端只改 base_url |
| 纯文本模型看不了图 | 内置导盲犬模式，前置视觉模型转述图片内容，不存记忆不碰 D1，纯转发 |
| 想给 Claude Code / Codex 加记忆 | 暴露成 MCP 工具，官方客户端直接连，跨设备跨应用随身记忆 |
| Cloudflare 全家桶看着头大 | 一条 `npm run deploy:cloudflare` 自动建 D1 + Vectorize + Queue，有手就行 |

---

## 三种用法，按需选

### 1. 完整版：聊天网关 + 记忆注入 + 每日整理

最常用的模式。客户端把请求打到 `/v1/chat/completions`，Aelios 做五件事：

```
客户端请求
  │
  ├─ 1. 认证 + 模型路由
  ├─ 2. 向量召回相关记忆 → reranker 重排 → 压缩模型精简
  ├─ 3. 记忆注入上下文
  ├─ 4. 转发给上游模型，流式返回
  └─ 5. 原始聊天存 D1，凌晨小秘书整理入 Vectorize
```

- 支持图片自动走视觉模型
- Claude prompt cache，复用稳定上下文降低成本
- D1 自动清理过期数据
- 支持深度思考（thinking budget）

### 2. 纯记忆库 MCP

只暴露记忆工具，不代理聊天模型。给 Claude Code、Codex、MCP 客户端调用。

```
你的 AI 客户端 ──MCP──→ Aelios /mcp
                         ├─ memory_search   搜索长期记忆
                         ├─ memory_create   手工创建记忆
                         ├─ memory_list     列出记忆
                         └─ memory_ingest   写入消息 + 自动抽取
```

官方客户端也能拥有跨设备、跨窗口、跨应用的随身记忆。

### 3. 无记忆导盲犬 API

针对纯文本 LLM，前置一个看图模型转述图片内容。不保存消息，不搜索记忆，不碰 D1。纯转发，只加一双眼睛。

---

## 记忆处理链路

这是 Aelios 最核心的部分，决定了"记住"和"记住有用的东西"之间的区别：

```
原始聊天 ──存 D1──→ 凌晨小秘书整理
                       │
                       ├─ 抽取重要事实、偏好、关系、项目背景
                       ├─ 与已有记忆合并或去重
                       └─ 写入 Vectorize（768维 cosine）

下次聊天时：
  用户消息
    │
    ├─ 向量粗召回 top 50（MEMORY_TOP_K）
    ├─ 低相关度地板，只挡明显噪音（MEMORY_MIN_SCORE = 0.1）
    ├─ 取前 12 条候选（MEMORY_FILTER_MAX_CANDIDATES）
    ├─ reranker 重排，取前 5 条（MEMORY_FILTER_MAX_OUTPUT）
    └─ 压缩模型精简，每条压到 300 字，注入上下文
```

不是一股脑全塞，是先粗筛、再精排、最后压缩，只给模型看最相关的几百字。地板放低是故意的：embeddinggemma 对"换了说法的相关记忆"打分偏低（约 0.15–0.20），地板太高会把它们直接挡掉；精排和压缩交给 reranker 和压缩模型来做。

---

## 部署：有手就行

### 第一步：Fork + 连 Cloudflare

1. Fork [wusaki0723/Aelios](https://github.com/wusaki0723/Aelios) 到自己 GitHub
2. Cloudflare Dashboard → Workers & Pages → Create application → 连 GitHub → 选你的 fork
3. 填配置：
   - Project name: `companion-memory-proxy`
   - Production branch: `main`（要用 v2 记忆系统就选 `memory-v2`，见开头「分支指路」）
   - Root directory: `/`
   - **Build command:** `npm ci`
   - **Deploy command:** `npm run deploy:cloudflare`
   - ⚠️ 必须是 `npm run deploy:cloudflare`，不是 `npm run deploy`，不是 `wrangler deploy`。这个命令会自动创建和升级 D1、Vectorize、Queue。

### 第二步：填最小必填变量

> ⚠️ **密钥必须用 Secret 类型（加密、不进 git），不要选成 Variable**。Cloudflare 面板「Variables and Secrets」里两类都列在同一处，但只有 Variable 会被 setup 脚本写进 git-tracked 的 `wrangler.toml`。名字带 `KEY`/`TOKEN` 的都走 Secret。详细列表和迁移步骤见 [SECRETS.md](./SECRETS.md)。

Settings → Variables and Secrets → Add：

| 变量名 | 类型 | 填什么 | 用来干嘛 |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 你的 Cloudflare Account ID | 创建和管理 D1 / Vectorize / Queue |
| `CLOUDFLARE_API_TOKEN` | **Secret** | 你的 Cloudflare API Token | 部署脚本和 Worker 管理 Vectorize |
| `CHATBOX_API_KEY` | **Secret** | 自己编一个密码，如 `sk-my-aelios-key` | 客户端和管理面板的访问密钥 |

> 老 fork 已经跑过 `deploy:cloudflare` 的姐妹：你的 git 历史可能已经被写入过明文密钥，必须按 [SECRETS.md 的「老 fork 迁移」](./SECRETS.md#3-老-fork-迁移你已经部署过怎么办) 清理 + rotate。

保存后重新部署。部署成功后你会拿到一个 Worker 地址：`https://companion-memory-proxy.<你的子域>.workers.dev`

此时记忆库已经能用了。默认 embedding、reranker、压缩模型都走 Cloudflare Workers AI，不需要额外配置。

### 第三步（可选）：接 AI Gateway 开启完整聊天网关

只想用记忆库可以跳过。想让 Aelios 当聊天网关，就配 AI Gateway：

1. Cloudflare → AI → AI Gateway → Create a custom gateway
2. 复制 Gateway Endpoint
3. 在 Provider Keys 里添加你的模型 API key
   *openrouter 调用 claude 模型务必使用第三方 api 方式添加，不要使用官方的 provider 路径，会导致 anthropic 格式和官方的 openai 格式打架。https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/custom-providers*
4. 回到 Worker → Variables and Secrets，添加：

| 变量名 | 填什么 |
|---|---|
| `AI_GATEWAY_BASE_URL` | 刚复制的 Gateway Endpoint |
| `CF_AIG_TOKEN` | AI Gateway 调用 token |

保存后重新部署。

### 第四步：客户端怎么填

以 Chatbox 为例：

- **Base URL:** `https://<你的 Worker 地址>/v1`
- **API Key:** 你设的 `CHATBOX_API_KEY`
- **Model:** `companion`

试着说："请记住：我的测试暗号是苹果星星-0428。" 过一会儿问："我的测试暗号是什么？" 答出来就通了。

### 管理面板

浏览器打开 `https://<你的 Worker 地址>/admin`（或 `/memory-admin`），填入 Worker URL 和 API Key，就能搜索、查看、新增、编辑、删除长期记忆。

---

## 可选入口

### 纯记忆库 MCP

环境变量加 `MEMORY_MCP_API_KEY`，MCP 地址：
```
https://<你的 Worker 地址>/mcp?token=<MEMORY_MCP_API_KEY>
```

### 无记忆导盲犬 API

环境变量加 `GUIDE_DOG_API_KEY`，客户端填：
- **Base URL:** `https://<你的 Worker 地址>/v1/guide-dog`
- **API Key:** 你设的 `GUIDE_DOG_API_KEY`
- **Model:** `companion`

导盲犬只转发模型，不写记忆、不读记忆、不保存聊天记录。

---

## 环境变量速查

### 最小记忆库必填

| 变量名 | 说明 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CHATBOX_API_KEY` | 客户端和管理面板连接密码 |

### 完整版聊天网关加填

| 变量名 | 说明 |
|---|---|
| `AI_GATEWAY_BASE_URL` | Cloudflare AI Gateway 地址 |
| `CF_AIG_TOKEN` | AI Gateway 调用 token |

### 模型配置（都有默认值，可选改）

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `CHAT_MODEL` | `deepseek/deepseek-v4-pro` | 主聊天模型 |
| `MEMORY_RERANKER_MODEL` | `workers-ai/@cf/baai/bge-reranker-base` | 向量召回后的 reranker |
| `ENABLE_MEMORY_RERANKER` | `true` | 设 `false` 跳过 reranker |
| `MEMORY_FILTER_MODEL` | `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 记忆压缩模型 |
| `MEMORY_FILTER_MAX_CANDIDATES` | `12` | 进入 reranker 的候选上限 |
| `MEMORY_FILTER_MAX_OUTPUT` | `5` | 压缩后注入上下文的记忆条数 |
| `MEMORY_FILTER_OUTPUT_CHARS` | `300` | 每条压缩记忆最多多少字 |
| `MEMORY_FILTER_MAX_TOKENS` | `1400` | 压缩模型 JSON 输出上限 |
| `DREAM_MODEL` | `deepseek/deepseek-v4-pro` | 后台记忆整理模型 |
| `VISION_MODEL` | `google-ai-studio/gemini-3-flash-preview` | 看图模型 |
| `EMBEDDING_MODEL` | `workers-ai/@cf/google/embeddinggemma-300m` | 向量嵌入 |
| `EMBEDDING_DIMENSIONS` | `768` | 非 Workers AI embedding 的目标维度 |

### Claude 专属（可选）

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `ANTHROPIC_THINKING_ENABLED` | `false` | 开启 Claude 深度思考 |
| `ANTHROPIC_THINKING_BUDGET` | `1024` | 思考 token 预算（1024-32000） |
| `ANTHROPIC_CACHE_ENABLED` | `true` | Claude prompt cache 开关 |
| `ANTHROPIC_CACHE_TTL` | `5m` | cache 时长（5m 或 1h） |
| `ANTHROPIC_AUTO_CACHE_ENABLED` | `true` | Anthropic 顶层 automatic cache |
| `ANTHROPIC_ROLLING_CACHE_ENABLED` | `true` | 滚动 cache 打点 |
| `ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE` | `20` | 前端历史窗口大小 |
| `FORCE_ANTHROPIC_NATIVE` | 空 | 设 `true` 强制走 Anthropic native |
| `CUSTOM_ANTHROPIC_MESSAGES_PATH` | `messages` | Claude 原生 messages 路径 |

### 高级（一般不用动）

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `MEMORY_TOP_K` | `50` | 向量粗召回条数 |
| `MEMORY_MIN_SCORE` | `0.1` | 向量召回地板，只挡明显噪音；精排交给 reranker |
| `MEMORY_FILTER_MIN_SCORE` | `0.1` | 进 reranker 前的向量地板，同样保持低 |
| `MEMORY_FILTER_MAX_CONTENT_CHARS` | `700` | 候选记忆每条最多保留多少字 |
| `MEMORY_MIN_IMPORTANCE` | `0.55` | 记忆写入最低重要性 |
| `MEMORY_BACKEND` | `vectorize` | 长期记忆主库（设 `d1` 回旧模式） |
| `VECTORIZE_INDEX_NAME` | `memo-kb` | Vectorize 索引名 |
| `ENABLE_AUTO_MEMORY` | 空（开启） | 设 `false` 关闭自动记忆 |
| `ENABLE_INCREMENTAL_MEMORY` | `false` | 设 `true` 恢复每轮即时抽取 |
| `ENABLE_DREAM` | `true` | 夜间整理开关 |
| `DREAM_TIME_ZONE` | `Asia/Singapore` | 按此时区切自然日 |
| `DREAM_MAX_MESSAGES` | `40` | 每次 dream 最多处理消息数 |
| `DREAM_MAX_RUNS` | `10` | 每次定时任务最多连续 dream 批数 |
| `DREAM_MAX_TOKENS` | `8000` | dream 模型最多输出 token |
| `DREAM_MEMORY_CONTEXT_LIMIT` | `40` | dream 时参考的旧记忆数量 |
| `DREAM_EXCERPT_LIMIT` | `8` | dream 每天最多保存的重要原文段落 |
| `EMPTY_MEMORY_MIN_CHARS` | `4` | 清理短空记忆的阈值 |
| `PUBLIC_MODEL_NAME` | `companion` | 客户端看到的模型名 |
| `IM_API_KEY` | 空 | 第二把钥匙（IM bot 用） |
| `DEBUG_API_KEY` | 空 | 调试接口钥匙 |
| `MEMORY_MCP_API_KEY` | 空 | 纯记忆库 MCP 单独钥匙 |
| `GUIDE_DOG_API_KEY` | 空 | 导盲犬 API 单独钥匙 |

---

## 最容易踩的坑

- **Deploy command 必须是 `npm run deploy:cloudflare`**，不是 `npm run deploy`，不是 `wrangler deploy`，否则变量会被覆盖、数据库不会升级。
- 重新部署变量不会丢，`deploy:cloudflare` 带 `--keep-vars`。
- Vectorize 不要手动删，默认索引 `memo-kb`，768 维 cosine。
- 看图会切换到 `VISION_MODEL`，确认它的价格你能接受。

---

## 对外接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/admin` `/memory-admin` | 记忆管理面板 |
| GET | `/v1/models` | 模型列表 |
| POST | `/v1/chat/completions` | 聊天（完整版） |
| POST | `/v1/guide-dog/chat/completions` | 导盲犬（无记忆） |
| GET / POST | `/mcp` | 纯记忆库 MCP |
| GET / POST | `/v1/memory` `/v1/memories` | 记忆 CRUD |
| POST | `/v1/memory/search` `/v1/memories/search` | 记忆搜索 |
| POST | `/v1/memories/ingest` | 写入原始聊天 |
| GET / PATCH / DELETE | `/v1/memory/:id` | 单条记忆操作 |
| GET / PUT / DELETE | `/v1/cache/:namespace/:key` | 缓存操作 |
| GET | `/v1/debug/cache_health` | 缓存健康检查 |

---

## AI 助手交接（给 Codex / Claude Code / Cursor / Gemini CLI）

### 项目定位

Cloudflare Workers 上的 OpenAI-compatible Memory Proxy。帮新用户部署时：指导用户 fork 源项目，Cloudflare 只关联用户自己的 fork，Secrets / Variables 都在用户自己的 Cloudflare 账号，不要直接关联 wusaki0723/Aelios。

### 核心架构

```
前端负责：角色卡、聊天风格、工具、网页搜索、当前上下文
Worker 负责：统一 API、记忆注入/写入、Claude cache、AI Gateway 代理
```

资源约定：

| 资源 | 值 |
|---|---|
| Worker | `companion-memory-proxy` |
| D1 | `companion_memory_proxy` |
| Vectorize | `memo-kb`（768 维 cosine） |
| Queue | `companion-memory` |
| Embedding | `workers-ai/@cf/google/embeddinggemma-300m` |
| Dimensions | 768（覆盖 EMBEDDING_MODEL 时输出维度需匹配） |

### 模型路由

```
model=companion → CHAT_MODEL
请求含 image → VISION_MODEL
模型名含 anthropic/claude → Anthropic native (/anthropic/v1/messages)
  ├─ 显式 cache_control 缓存稳定 system 前缀
  ├─ dynamic_memory_patch 后移到当前 user 块，不进入缓存前缀
  └─ rolling user cache 默认开，automatic cache 默认关
custom-provider/claude-* → Provider-specific native (/custom-provider/messages)
其他 → OpenAI compat (/compat/chat/completions)
workers-ai/@cf/... → env.AI.run（不走 AI Gateway）
```

### 记忆系统完整流程

**注入（聊天前）：**

```
取最后一条 user 消息 → EMBEDDING_MODEL 生成向量 → Vectorize 搜索
→ 分数过滤 + 去重 → reranker 重排 → 压缩模型精简 → 注入上下文
```

**维护（聊天后）：**

```
保存 messages 到 D1 → 默认不即时抽取
→ 每天 04:10 (DREAM_TIME_ZONE) 触发 scheduled dream
  ├─ 只读昨天自然日的原始聊天
  ├─ 按 DREAM_MAX_MESSAGES 分批，最多 DREAM_MAX_RUNS 批
  ├─ 读取旧 active 记忆参考
  ├─ 清理空/短记忆
  ├─ DREAM_MODEL 新增高质量长期记忆 + 保存重要原文摘录
  ├─ 合并重复、替换过时、更新冲突
  └─ 原始 messages 只保留 3 天
```

恢复每轮即时抽取：`ENABLE_INCREMENTAL_MEMORY=true`

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

### 三种模式边界

1. **完整版** `/v1/chat/completions`：认证、模型路由、记忆搜索/注入、消息保存、Queue 维护、D1 清理、Claude cache。
2. **纯记忆库 MCP** `/mcp`：只暴露记忆工具，不代理聊天。用 D1、Vectorize、Queue，不走 `/v1/chat/completions`。
3. **无记忆导盲犬** `/v1/guide-dog/chat/completions`：只转发模型，不写记忆、不读记忆、不存聊天。

REST 记忆管理（返回 Vectorize 原始记忆，不经压缩）：
`GET/POST /v1/memory`、`GET/PATCH/DELETE /v1/memory/:id`（`/v1/memories` 兼容路径同路）。

记忆搜索（给模型召回用，可能被压缩加工）：
`POST /v1/memory/search`，传 `filter: false` 跳过 reranker 只返回原始命中，传 `include_prompt: true` 直接拿可注入的文本。

### 本地开发

```bash
npm install
npm run deploy:cloudflare   # 自动创建/升级 D1 + Vectorize + Queue + 部署
npm run worker:test         # 跑测试
```

### 记忆库清洗

旧 Vectorize 里长块、多主题块、重复总结多时，可让 LLM 先生成清洗计划：

```bash
AELIOS_BASE_URL="https://<worker>" \
AELIOS_API_KEY="<CHATBOX_API_KEY>" \
AI_GATEWAY_BASE_URL="<AI Gateway Endpoint>" \
CF_AIG_TOKEN="<AI Gateway Token>" \
CLEANUP_MODEL="deepseek/deepseek-v4-flash" \
npm run vectorize:clean:llm
```

---

## License

MIT

## 交流与反馈

有问题、想交流，欢迎来 QQ 群：**1091783659**
