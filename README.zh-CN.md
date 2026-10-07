简体中文 | [English](README.md)

# Aelios

给 AI 加一颗长期记忆。换窗口、换客户端、换模型，记忆跟着你走。

它是一个跑在 Cloudflare 上的记忆网关：你的 Chatbox / Claude Code / Codex 先连它，它再把请求转给模型。对话会被记下来，下次自动想起来。

## 怎么用

就三步。

### 1. 部署

先 Fork 本仓库，再部署你的 Fork。这样以后每次更新都只要点一下（见[更新到最新版](#更新到最新版)）。

1. 点本页右上角的 **Fork**。
2. 在 Cloudflare 后台进 **Workers & Pages → Create → Import a repository**，连上 GitHub，选你的 Fork。项目名保持 `companion-memory-proxy`，构建命令 `npm ci`，部署命令 `npm run deploy`。部署命令会自己建好 D1 数据库、Vectorize 索引和队列。
3. 部署好以后，进 Worker 的 **Settings → Variables and Secrets**，加 Secret `CHATBOX_API_KEY`：自己编一个密码，比如 `sk-my-aelios`。只有这一个必填，其余可选的钥匙见 [SECRETS.md](SECRETS.md)。

部署完会得到一个地址，类似：

```
https://companion-memory-proxy.<你的子域>.workers.dev
```

不要用裸 `wrangler deploy`，那样不会建库。

**不推荐：一键部署按钮。** [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wusaki0723/Aelios)

按钮能用，但 Cloudflare 是把本仓库复制一份到你账号里的新仓库，不是 Fork。复制品在 GitHub 上没有 Sync fork，以后每次更新都得手动把新代码拉过去。实在要用的话：表单里只必填 `CHATBOX_API_KEY`；Vectorize 那栏照抄 Dimensions `1024`、Metric `cosine`；构建命令 `npm ci`，部署命令 `npm run deploy`。已经用按钮装好了？看[用按钮装的怎么办](#用按钮装的怎么办)。

### 2. 加一个助手

浏览器打开：

```
https://<你的 Worker 地址>/admin
```

填 Worker 地址和刚才那把钥匙，进「设置」。

1. **上游地址**：填你的 Cloudflare 账号 ID（32 位）。要用完整聊天转发的话，再在 Worker Secrets 里加 `CLOUDFLARE_API_TOKEN`。
2. **助手**：点「添加助手」，例如：

   | 栏 | 填什么 | 例子 |
   |---|---|---|
   | 名字 | 地址里那一段，小写英文 | `coder` |
   | 主模型 | 只有这些模型会记、会召回 | `anthropic/claude-opus-4-5` |
   | 钥匙 | 谁能用这个助手 | 勾选主钥匙 |

3. 点「保存」。

一个助手一个地址。名字写成 `coder`，地址就是：

```
https://<你的 Worker 地址>/coder/v1
```

主模型才有记忆。没登记的模型（比如 Claude Code 里的小模型）只是路过，不记也不召。

### 3. 客户端指过来

API Key 一律填 `CHATBOX_API_KEY`。模型名写成 `厂商/模型`，比如 `anthropic/claude-opus-4-5`。

| 你用什么 | 填这个地址 |
|---|---|
| Chatbox、Cherry Studio 等 | `https://<Worker 地址>/coder/v1` |
| Claude Code | `ANTHROPIC_BASE_URL=https://<Worker 地址>/coder` |
| Codex | `base_url = https://<Worker 地址>/coder/v1`，并设 `wire_api = "responses"` |

不带助手名的 `/v1` 会走这把钥匙的第一个助手。

试一句：「请记住：我的测试暗号是苹果星星-0428。」过一会儿再问：「我的测试暗号是什么？」答出来就通了。

## 更新到最新版

GitHub 不会自己更新 Fork。有新版本时：

1. 在 GitHub 打开你的 Fork，点 **Sync fork → Update branch**。
2. Cloudflare 看到新提交会自己构建、部署，进度在 Worker 的 **Deployments** 里看得到。

记忆、设置、助手和钥匙都存在你的 Cloudflare 账号里，不在仓库里，同步不会丢。改设置请在 `/admin` 里改，别去改 Fork 里的文件，这样 Sync fork 一直是点一下就好，不会冲突。

想让它自动同步？[Pull](https://github.com/apps/pull) 这个 App 能定时帮 Fork 同步。但那样每个新版本都会不经你看就直接上线，包括数据库迁移；而且 Pull 默认把你的 Fork 硬重置成本仓库，你自己的提交会被丢掉。推荐手动点同步。

### 用按钮装的怎么办

按钮装出来的是复制品，不是 Fork，没有 Sync fork。把 Worker 换到 Fork 上就好，记忆和设置都在 Cloudflare 里，不会动。

1. Fork 本仓库。
2. 如果你当时在按钮的设置页改过 D1 数据库或 Vectorize 索引的名字：进 Worker 的 **Settings → Build → Build Variables and Secrets**，加 `CMP_D1_NAME` 和 `CMP_VECTORIZE_NAME`，填你改过的名字。不加的话，构建会新建两个空的，记忆看起来像没了（其实还在旧库里）。
3. 在 **Settings → Build** 点 **Disconnect**，再点 **Connect** 选你的 Fork，构建命令 `npm ci`，部署命令 `npm run deploy`。
4. 如果 Cloudflare 往你的 Fork 提了一个修 Worker 名字的 PR，合掉它。

之后 Cloudflare 会在你的 Fork 有变化时从它构建，所以下次点 Sync fork 就更新上来了。在那之前 Worker 继续跑现在的版本。

## 平时怎么管

打开 `/admin`，底部几个标签：

| 标签 | 干什么 |
|---|---|
| **今日** | 今天聊了什么 |
| **审核队列** | 夜间整理出来的候选记忆。默认每晚由 Cloudflare 的 clef 审完，这周定下的都列在这里，不对就撤回。设置里关掉 clef 后候选留在这里等你批，也可以让助手用 MCP 自己审 |
| **重要记忆** | 浏览、搜索、改、删 |
| **更多** | 珍贵原文、术语表、维护工具 |
| **设置** | 上游、助手、环境参数 |

想让 AI 记住、忘掉、改掉什么，在面板点就行。

## 它实际在做什么

```
你的客户端  →  Aelios（认助手、记、召回）  →  模型
```

- 你每说一句，相关旧记忆会贴到这次对话里。
- 对话原文先存下来；夜里自动整理成长期记忆（Dream），每个助手用自己在聊的那个模型决定记不记，它定下的你随时能撤回。
- 记忆存在你自己的 Cloudflare（D1 + Vectorize），不绑某个聊天窗口。

一个助手可以写一个空间、读好几个空间。比如新对话写 `coder`，同时还能读旧库 `coder-old` 和共享的 `shared-docs`。不填召回空间就只读自己那个。

## 可选功能

**完整聊天网关**（想让 Aelios 转发各家模型，用你自己的 key 计费）

1. Cloudflare → AI → AI Gateway，建一个 gateway，把各家 key 存在它下面。
2. Worker Secrets 加 `CLOUDFLARE_API_TOKEN`。
3. `/admin` 设置里，上游填 32 位账号 ID，再加助手。

不配这些，记忆召回和夜间整理也能跑（走 Workers AI）。

**给 Claude Code / Codex 加 MCP 记忆**

```
https://<Worker 地址>/mcp?token=<CHATBOX_API_KEY>
```

想让 Claude Code 每条消息自动召回、批量写回，用仓库里的 Hook：[`integrations/claude-code/`](./integrations/claude-code/README.md)。

**看图**

加 Secret `GUIDE_DOG_API_KEY`，客户端改成：

- 地址：`https://<Worker 地址>/v1/guide-dog`
- 模型：`companion`

导盲犬只转述图片，不写记忆。

## 最容易踩的坑

- 部署用 `npm run deploy`，不要裸 `wrangler deploy`。
- 助手名字是地址的一部分，用 `coder` 这种英文，别用空格。
- 模型名要带厂商前缀：`anthropic/claude-opus-4-5`，不要只写 `claude-opus-4-5`。
- 只有助手里登记的主模型才有记忆。小模型、杂务模型别写进去。
- Vectorize 索引别手动删（`memo-kb`，1024 维 cosine）。

## 想看细节

- 网关怎么路由、怎么记、怎么召回：[docs/memory-gateway.md](docs/memory-gateway.md)
- 请求会改什么、thinking 怎么处理：[docs/request-contract.md](docs/request-contract.md)
- 哪些密钥必填：[SECRETS.md](./SECRETS.md)
- 维护、端点、MCP 工具：下面这一段

---

# 给维护的人

Cloudflare Workers 上的记忆网关。帮用户部署时只关联**用户自己的 fork**，Secrets 都在用户自己的账号。

| 资源 | 值 |
|---|---|
| Worker | `companion-memory-proxy` |
| D1 | `companion_memory_proxy` |
| Vectorize | `memo-kb`（1024 维 cosine） |
| Queue | `companion-memory` |
| Embedding | `workers-ai/@cf/baai/bge-m3` |

入口：`/<助手>/v1/chat/completions`、`/<助手>/v1/messages`、`/<助手>/v1/responses`。不带助手名的 `/v1/...` 走该钥匙的第一个助手。

CF 上游：chat 走 compat（全厂商，BYOK）；messages / responses 走各厂商原生端点。模型名原样透传，厂商认不出来由上游报错。自定义 OpenAI 兼容地址原样转发。

配置三层，都在 `/admin` 的「设置」：上游、助手、环境参数。优先级：面板保存的 > `GATEWAY_CONFIG` > 空配置。

### 常用端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/admin` | 管理面板 |
| GET | `/v1/models` | 模型列表 |
| POST | `/<助手>/v1/chat/completions` | OpenAI 兼容聊天 |
| POST | `/<助手>/v1/messages` | Anthropic messages |
| POST | `/<助手>/v1/responses` | OpenAI responses |
| GET / POST | `/mcp` | MCP 记忆工具 |
| GET / POST | `/v1/memories` | 记忆列表 / 新建 |
| POST | `/v1/memory/recall` | 动态召回（hook 优先用这个） |
| POST | `/v1/search/memories` | 原始搜索（不记账） |
| POST | `/v1/ingest/messages` | 写入原始聊天 |
| GET | `/v1/memory_boot` | 冷启动包 |
| GET | `/v1/diary` `/v1/diary/recent` | 日记 |
| GET / POST / DELETE | `/v1/precious` `/v1/glossary` | 珍贵原文 / 术语表 |
| GET / POST | `/v1/candidates` | 审核队列；`/decisions?days=7` 自动决定清单，`/:id/undo` 撤回 |

非 `/health` `/admin` 都要 `Authorization: Bearer <key>`。网关按助手钥匙鉴权，记忆接口按 `memory:read` / `memory:write`。

### MCP 工具

`memory_search` `memory_list` `memory_get` `memory_delete` `memory_ingest` `memory_boot` `memory_recall` `memory_upsert` `memory_supersede` `memory_archive` `memory_pin` `glossary_set` `diary_get` `memory_export` `memory_candidates` `memory_review`

### 记忆怎么走

写入：助手直写 `memory_upsert`；夜里 cron（`10 20 * * *`）从当天对话抽事实 → 候选由 Cloudflare 的 clef 判记住或放下（`CLEF_AUTO_REVIEW`，默认开；关掉后候选留给人工，或让助手用 MCP 的 `memory_candidates`、`memory_review` 自己审），并写日记 / 周记 / 月记。

召回：最后一句用户话 → 向量搜索 + 词面 → 原文片段批量重排 + 规则 → 把干净原文贴到当前消息末尾。默认不调用生成式 LLM，日常最多一条，回答旧事最多两条；低分不凑数，重排失败回落词面。分数与取舍可在 `/admin → 设置` 查看。传输信封、哈希和消息 ID 不进入日常提示，同一会话里直接相邻且 90 秒内的两句会合并；主动搜索仍返回完整记录和 ID。日记不自动注入。

清理：消息约 7 天；一条记忆 180 天里没被改写、没被想起、也没再被提到，才标过期（置顶和 identity、persona 不会过期），失效记录再过 30 天硬删。

### 本地验证

```bash
npm install
npm run verify
```

测试需要 Node.js 22+。

CI 里 lint 是阻断的：`npm run lint` 必须零 error 才能合并。仍有 17 个 `noNonNullAssertion` warning，这条规则在 `biome.json` 里被降为 warning，不影响退出码 —— 清不清由改到那行的人自己判断，别用 Biome 的自动修复批量改，它会把 `x!.y` 换成 `x?.y`，把「出错就炸」变成「悄悄返回 undefined」。

## License

AGPL-3.0

可自由使用、修改；若把修改后的版本对外提供网络服务，须以相同许可开源修改后的源码。

v1 最终封存点在 tag `v1-final`（当时仍是 MIT）。`tg-bot` 是 Telegram 集成分支，截至 2026-09-11 停在 2026-07-16，之后 main 领先它 154 个 commit（135 个文件、约 1.8 万行改动），分支自己只加了 17 个文件，按现状合不回去。留着当历史看；要捡回来得先 rebase 到 main，别直接合。

## 交流

QQ 群：**1091783659**
