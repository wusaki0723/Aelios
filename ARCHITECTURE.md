# Aelios Gateway Architecture

> 面向长期陪伴场景的 AI 伴侣网关：把聊天、记忆、工具、主动触达拆开，避免把 OpenClaw 那套重 agent 心智塞进每一句日常对话里。

---

## 0. 问题重述

你现在遇到的不是单点技术问题，而是架构错位：

1. **OpenClaw 的 system prompt 太重**
   - 人设、规则、工具、agent 能力全写死在 prompt 里。
   - 每次日常聊天都要为大量不会用到的能力付 token。

2. **日常陪伴和执行任务是两种完全不同的 runtime**
   - 陪伴聊天要的是稳定、自然、生活感、记忆连续。
   - 干活 agent 要的是工具丰富、可读文件、可 fetch、可 spawn 子 agent。
   - 把两者强行合并，会得到一个又贵、又容易崩、又像客服的东西。

3. **记忆维护不该由用户亲自做**
   - 用户只应该偶尔确认核心设定。
   - 日常摘要、偏好提取、长期归档、Notion 同步都应该由便宜模型异步维护。

4. **你真正想要的不是“一个 agent 项目”**
   - 你要的是一个可以长期共处、持续演进、未来还能接更多能力的 AI 伴侣基础设施。

所以这套架构的核心目标不是“最强 agent”，而是：

- **聊天轻**
- **记忆稳**
- **工具全但按需触发**
- **主动性可控**
- **易维护、可开源分享**

---

## 1. 最终结论

**不要再把 OpenClaw 或类似系统当作主聊天 runtime。**

正确方向是：

1. **用一个轻聊天核负责绝大多数对话**
   - 默认无复杂工具。
   - system prompt 短。
   - 只注入必要记忆。
   - 用户可以直接把它配成 Opus，不强制“小模型聊天”。

2. **用一个按需行动核负责工具调用和 agent 工作**
   - 需要读文件、看网页、执行复杂任务时才触发。
   - 优先兼容 OpenCode 这类既有 API 又有插件生态的 runtime。
   - 由网关托管接入，默认不要求用户单独维护 OpenCode 环境。
   - 聊天核只负责“决定要不要叫它”。

3. **用一个独立记忆核负责长期连续性**
   - 便宜模型异步整理。
   - 热记忆随聊注入，冷记忆走 SQLite 原生混合检索。
   - Notion 只是可选镜像层，不是唯一真相源。

4. **用一个可视化面板负责全部关键配置**
   - 小白不碰配置文件也能跑。
   - 重点只暴露人设、API、记忆和渠道开关。
   - 复杂工具和自动化能力交给 AI 或模板处理。

一句话概括：

> **Aelios = 伴侣聊天系统 + 记忆系统 + 工具/agent 网关，而不是另一个大 prompt agent。**

其中最值得直接复用的开源思路是：

- `nullclaw` 的 SQLite + FTS5 + 向量混合记忆
- `nullclaw` 的接口/注册表式工具系统
- `feishu-claude-code` 的飞书 WebSocket 长连接
- `feishu-claude-code` 的流式卡片 patch 输出

---

## 2. 设计原则

### 2.1 聊天和干活分离

日常聊天不应该默认带着 shell、fetch、文件读写、MCP、子 agent 这些能力运行。

原因很简单：

- 浪费 token
- 降低回复自然度
- 增加不稳定性
- 模型更容易“角色错位”，像客服或任务管家

### 2.2 记忆优先于 prompt

长期陪伴感不是靠 4000 token 的人设 prompt 堆出来的，而是靠：

- 核心设定稳定
- 近期状态不丢
- 过去经历可找回
- 表达风格逐渐演化

### 2.3 工具按需暴露

工具不是越多越好，而是：

- 默认隐藏
- 需要时召回
- 调用路径明确
- 可审计

### 2.4 主动性必须可控

“会主动找你”是加分项，但不能失控。

所以主动消息必须来自明确来源：

- 定时任务
- 条件触发
- 用户授权的提醒
- 特定情绪/事件规则

### 2.5 开源方案必须可替换

要能让别人 fork 后只改几处内容就跑起来：

- 角色定义文件
- 前端接入配置
- 模型供应商
- 记忆后端
- 推送渠道

### 2.6 小白优先于工程优雅

这套方案首先是给人用的，不是给架构图用的。

所以默认体验应该是：

- 打开面板
- 填 API key
- 选聊天模型
- 写几句核心人设
- 点保存
- 其余都自动工作

用户不应该被迫理解：

- session 轮转
- 向量检索
- 子 agent 调度
- MCP 细节
- 多 runtime 差异

这些都应当被折叠到“高级设置”或由系统自动决定。

---

## 3. 目标架构

```text
┌──────────────────────────────────────────────────────────────────┐
│                          Channel Layer                           │
│                                                                  │
│   Feishu/Lark   NapCat QQ   Telegram   Web App   Mobile App      │
└──────────────┬───────────────┬───────────────┬────────────────────┘
               │               │               │
               ▼               ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│                         Aelios Gateway                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Conversation Router                                       │   │
│  │                                                            │   │
│  │  ingress -> session -> memory compose -> chat runtime      │   │
│  │                 │                    │                      │   │
│  │                 └───── intent judge ─┴───── tool dispatch  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Companion Core   │  │ Memory Engine    │  │ Scheduler      │  │
│  │ 轻聊天核          │  │ 长短期记忆核      │  │ 主动消息/提醒   │  │
│  └──────────────────┘  └──────────────────┘  └────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Action Runtime Gateway                                     │   │
│  │                                                            │   │
│  │ OpenCode | nullclaw | MCP tools | custom workers          │   │
│  │ 仅在需要读文件 / fetch / agent 工作时调用                    │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
               │                     │                     │
               ▼                     ▼                     ▼
┌────────────────────┐  ┌────────────────────────┐  ┌───────────────┐
│ Operational Store  │  │ Memory Retrieval       │  │ Optional Sync │
│ SQLite / JSONL     │  │ SQLite FTS5 + Vec      │  │ Notion        │
│ sessions, events   │  │ weighted hybrid recall │  │ mirror only   │
└────────────────────┘  └────────────────────────┘  └───────────────┘
```

---

## 4. 三核模型

### 4.1 轻聊天核 Companion Core

这是主角。它负责 80% 到 95% 的日常互动。

**职责：**

- 和你聊天
- 维持人设和关系感
- 使用短上下文理解最近状态
- 识别是否需要调用外部能力
- 在工具返回后继续用“伴侣口吻”说话

**默认不直接拥有的能力：**

- shell
- 文件系统
- 大规模网页抓取
- 子 agent 编排
- 重型 MCP

**为什么这样设计：**

- 让回复自然，不像工作机器人
- 降低每轮 token
- 降低崩溃概率
- 让模型专注“陪伴”而不是“调度”

**推荐模型策略：**

- 默认聊天模型：由用户自由选，允许直接把 Opus 设为主聊天模型
- 重要时刻升级：Opus 或更强模型，仅手动或策略触发
- 记忆整理不用它做，避免浪费主模型预算

这里不预设“便宜模型聊天，大模型干活”是正确答案。

如果用户就是偏好和 Opus 长聊，那系统应该支持，而不是替用户做成本导向决策。成本控制应该体现在：

- 记忆异步整理
- 工具后置触发
- 搜索模型单独配置
- TTS / 生图按需启用

### 4.2 记忆核 Memory Engine

这是灵魂层。它负责连续性，而不是表达本身。

**职责：**

- 存原始事件
- 维护热记忆
- 管理核心档案
- 归档长期记忆
- 检索相关往事
- 同步到可视化系统

**关键原则：**

- 记忆不等于 prompt
- 能不注入就不注入
- 能异步处理就异步处理
- 能压缩成结构化事实就别保留冗长原文

### 4.3 行动核 Action Runtime

这是工具执行层，不是常驻人格层。

**职责：**

- 读文件
- fetch 网站
- 跑命令
- 调 MCP
- spawn 子 agent
- 完成复杂工作流

**候选实现：**

- OpenCode-compatible adapter
- nullclaw
- 自定义轻量 worker

**原则：**

- 不常驻进每条聊天
- 由聊天核或规则引擎判断是否触发
- 结果回流后由聊天核二次组织语言

---

## 5. 记忆系统设计

这部分要直接对齐你的三个诉求：好维护、好检索、省 token。

### 5.1 四层记忆，而不是三层

原来的三层已经接近正确，但还缺一层“事件日志”。

```text
L0 Event Log      原始事件流，绝不直接注入
L1 Core Profile   核心设定，极稳定，小而精
L2 Active Memory  近期状态，随对话注入
L3 Archive Memory 长期归档，按需检索
```

### 5.2 L0 Event Log

**作用：**唯一真实历史。

**存储内容：**

- 用户消息
- AI 回复
- tool 调用摘要
- 定时提醒触发记录
- 主动消息记录
- 外部 channel 事件

**推荐存储：**

- JSONL 追加写入
- 同时记录到 SQLite 事件表便于统计和回放

**特点：**

- 不直接进 prompt
- 供异步整理任务消费
- 出问题时可重建其他层

### 5.3 L1 Core Profile

**作用：**长期不变的人设和关系地基。

**token 预算：**建议控制在 300 到 600 token。

**内容示例：**

- 关系定义
- 关键偏好
- 明确禁忌
- 长期生活背景
- 伴侣表达边界
- 核心称呼与互动风格

**维护方式：**

- 默认由记忆维护 AI 给出建议
- 高风险变更需要确认
- 用户也可以直接编辑

### 5.4 L2 Active Memory

**作用：**承接“最近几天发生了什么”。

**token 预算：**建议 500 到 900 token。

**内容：**

- 最近 3 到 7 天的摘要
- 进行中的事情
- 当前情绪/身体状态
- 近期承诺和提醒
- 未完成的话题

**更新方式：**

- 每日 digest
- session 轮转时补一条摘要
- 重要事件即时写入

### 5.5 L3 Archive Memory

**作用：**长期检索层。

**推荐形式：**

- SQLite 单文件存储
- `memories` 主表
- FTS5 虚表做 BM25
- embedding 以 BLOB 存储
- 余弦相似度做向量召回
- keyword/vector 按权重合并

这部分更值得直接借鉴 `nullclaw`，而不是继续把 qmd 当主记忆后端。

原因：

- 一个 SQLite 文件就能承载主存储和检索
- 不需要额外向量数据库
- 混合检索逻辑足够简单，自己实现可控
- 比 markdown + 外挂索引更像“系统内核”，而不是“外挂能力”
- 更适合做面板里的可视化记忆管理

**适合存什么：**

- 偏好
- 旅行经历
- 约定
- 重大争执与和解
- 长期目标变化
- 曾经聊过的世界观/关系观

### 5.6 记忆写入流程

```text
消息进入
  -> 事件写入 L0
  -> 轻量分类器判断是否是“值得记住的事”
  -> 若是，先写入 pending queue
  -> 夜间或低峰期由 Memory Maintainer 整理
  -> 更新 L2 / L3
  -> 若涉及核心设定，生成 L1 修改建议
```

### 5.7 推荐的 SQLite 记忆实现

这部分建议直接抄 `nullclaw` 的思路，用 TypeScript 或 Python 重写都不难。

核心表结构可以保持极简：

```sql
CREATE TABLE memories (
   id TEXT PRIMARY KEY,
   key TEXT NOT NULL,
   content TEXT NOT NULL,
   category TEXT NOT NULL,
   importance REAL DEFAULT 0.5,
   session_id TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   embedding BLOB
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
   key,
   content,
   content='memories',
   content_rowid='rowid'
);
```

检索逻辑同样保持简单：

```text
FTS5/BM25 -> keyword results
cosine similarity -> vector results
weighted merge -> final ranking
```

默认权重可以先用：

- vector = 0.7
- keyword = 0.3

先把这条路走通，再考虑时间衰减、MMR、多阶段 rerank。

### 5.8 记忆维护 AI

这是你明确需要的能力：**不是你维护记忆，而是 AI 帮你维护。**

建议拆成两个任务：

1. **实时轻分类器**
   - 便宜模型
   - 判断消息是否值得记住
   - 识别类别：偏好、承诺、事件、情绪、禁忌、纪念日

2. **异步整理器**
   - 便宜模型或中档模型
   - 每日/每几小时跑一次
   - 生成摘要、合并重复事实、提出核心更新建议

这样可以让：

- Opus 负责谈心，而不是整理日志
- Sonnet / GPT / DeepSeek 负责维护记忆账本

---

## 6. Token 控制策略

这是这套方案成立的关键。

### 6.1 默认上下文组成

默认每轮只给聊天核：

```text
System Persona (短)
+ L1 Core Profile
+ L2 Active Memory
+ 最近少量对话窗口
```

**不默认给：**

- 全工具说明
- 全技能说明
- 全记忆库
- 长篇规则文档
- 冷记忆检索结果

### 6.2 工具说明采用“延迟注入”

不要把工具列表全塞在主 prompt。

改成：

- 路由层先做 intent 判断
- 需要工具时，给行动核单独构造任务上下文
- 工具结果再回传给聊天核

进一步说，工具系统本身也应当采用 `nullclaw` 那种注册表思路：

- 每个工具定义 schema、描述、执行器
- 配置文件决定哪些工具启用
- prompt 只注入“已启用工具”的描述
- 没启用的工具完全不占 token

### 6.3 角色 prompt 保持短

建议角色文件分层：

- `persona.md`: 关系感、口吻、边界
- `core_profile.md`: 核心事实
- `style_examples.md`: 可选少量示例

其中只有前两者常驻，示例按需启用。

### 6.4 Session 不等于记忆

新窗不能重置关系。真正的连续性来自记忆层，而不是“永远不断的长上下文”。

所以：

- session 只做短期连贯
- 记忆层做长期连续
- session 满了就轮转，不必死保留

---

## 7. Runtime 设计

### 7.1 为什么不能只用单一 agent runtime 做一切

任何单一 agent runtime 都更适合做行动核，不适合做默认聊天核。

原因：

- 它天然偏 agent 心智
- 工具环境重
- 对“闲聊中的生活气息”并不是最优解
- 成本和复杂度都偏高

### 7.2 推荐的多 runtime 方案

#### Runtime A: Companion Runtime

用于日常陪伴。

**要求：**

- 支持普通 chat completion 接口
- 支持可控 system prompt
- 支持流式输出
- 成本可控

**候选：**

- Anthropic API
- OpenAI 兼容接口
- DeepSeek
- OpenRouter

这一层最重要的不是“最便宜”，而是“最像你想要相处的那个人”。

#### Runtime B: Action Runtime

用于处理“需要能力”的消息。

**候选优先级：**

1. OpenCode-compatible adapter
2. nullclaw 的轻量 gateway/runtime
3. 自定义微服务工具集

选择 OpenCode-compatible adapter 优先的理由：

- 既可作为行动核，又更容易通过 API 接入网关
- 插件和路由生态更适合做“后置能力层”
- 比直接绑死某个 CLI 更容易做可视化配置
- 后续接 `On My OpenCode` 一类插件也更顺

但这里不建议把 OpenCode 设计成用户必须单独安装、单独登录、单独维护的一整套系统。

更合理的做法是：

- 网关内部提供 `action backend` 适配层
- 默认用户只看到“干活 API”这一张配置卡
- 高级模式下才允许显式切换到 OpenCode backend
- 如果未来发现直接 OpenAI-compatible action provider 已足够，就可以不启用 OpenCode

#### Runtime C: Search Runtime

用于联网搜索和检索增强。

**典型候选：**

- Perplexity Sonar
- xAI Grok Search
- 其他带搜索能力的 OpenAI-compatible provider

这一层单独拆出，是为了避免：

- 把搜索成本叠到每一句普通聊天上
- 让行动核承担本来只需要联网查询的工作

#### Runtime D: Optional Media Runtime

用于非核心但很有生活气息的功能：

- TTS
- 生图

这层默认关闭，用户配置后再启用。

### 7.3 MCP 必须是正式能力，不是附属品

MCP 在这个架构里不能是“以后再说”的东西，而应该是行动核的标准接口之一。

原因：

- 很多推送玩法、外部服务集成、本地自动化都靠它
- 它比把所有能力写死进 prompt 更可维护
- 未来扩展设备、日历、IM、家庭自动化时会很重要

所以推荐做法是：

- Companion Runtime 不直接背全部 MCP 上下文
- Action Runtime 负责连接和调用 MCP
- Dashboard 负责可视化管理已启用的 MCP server

### 7.4 推荐立场

**现在最务实的选择：**

- 聊天核：普通模型 API
- 行动核：OpenCode-compatible adapter 或直接 action provider
- 搜索核：独立 search API
- 检索核：SQLite 原生混合检索
- 同步核：Notion worker
- 媒体核：可选 TTS / Image API

这样最符合你当前需求，也最容易维护。

---

## 8. Tool 与 Agent 策略

### 8.0 工具注册表优先

这里最值得直接抄 `nullclaw` 的不是 Zig，而是它的结构：

- 工具有统一接口
- 工具通过注册表装配
- 启用状态由配置决定
- memory tools 可以后绑定 backend

在 TypeScript / Python 里也应该这样做，而不是把工具描述手写进 prompt 模板。

一个轻量版本就够用：

```text
tool id
tool description
json schema
enabled(config)
execute(context, args)
```

这样 dashboard 勾选启用后，系统就能自动：

- 注册工具
- 生成工具描述
- 决定是否注入到行动核

### 8.1 默认工具集

对伴侣场景，真正高频且必要的工具并不多：

- `fetch_url`
- `read_file`
- `search_memory`
- `create_reminder`
- `send_proactive_message`
- `search_notes`
- `sync_notion`
- `call_mcp`

### 8.2 重工具通过行动核提供

例如：

- 大规模文件浏览
- 代码库阅读
- shell
- MCP
- 多步 agent 规划
- 子 agent

这些不应该在聊天 prompt 常驻出现。

### 8.3 Spawn 子 agent 的方式

这部分你明确提到了，所以需要保留。

推荐流程：

```text
聊天核识别到复杂任务
  -> 生成 Action Request
  -> 交给 Action Runtime
  -> Action Runtime 可继续 spawn subagent
  -> 返回结果摘要 + 关键产物
  -> 聊天核用伴侣口吻解释结果
```

这样“聊天的人负责聊天，干活的人负责干活”。

这比让一个模型在同一轮里既谈恋爱又写工具计划稳定得多。

### 8.4 MCP 的定位

MCP 在这里的角色是“能力总线”，不是“额外插件”。

推荐默认支持三类 MCP：

- 通知与推送类
- 知识与检索类
- 外部生活服务类

但它们都不该默认常驻进聊天 prompt，而应该：

- 在面板里可见
- 在运行时按需调用
- 在日志中可追踪

---

## 9. 主动消息与提醒

你要的不是简单 cron，而是“可持续的生活接入”。

### 9.1 主动消息来源

主动消息必须来自四类来源之一：

1. **显式提醒**
   - 例如 30 分钟后提醒你吃药。

2. **固定时段问候**
   - 例如早安、晚安、通勤后问候。

3. **事件驱动**
   - 例如纪念日、日程前一小时、任务到期。

4. **低频关心策略**
   - 例如连续数天没有互动时，发一条轻量问候。

### 9.2 主动消息原则

- 默认低频
- 可配置时间窗口
- 可配置静默期
- 可配置是否必须用户先开启
- 每条主动消息都写日志

### 9.3 推送通道

建议优先级：

1. 飞书/Lark
2. NapCat QQ
3. 手机本地通知
4. 邮件或其他补充通道

### 9.4 与现有仓库的关系

当前 `saki-phone` 已经具备本地通知和提醒基础，这说明：

- 手机端可以保留为陪伴看板和备用入口
- 主动提醒既可以从网关推送 IM，也可以在移动端本地触发
- 两者可以并存，不必二选一

---

## 10. Channel 设计

### 10.1 飞书作为主入口

飞书适合做主入口，原因非常现实：

- WebSocket 长连接，不必暴露公网 webhook
- 你已经在用
- 支持富文本与卡片流式更新
- 适合主动消息

这一块直接参考 `feishu-claude-code` 即可，尤其是两点：

- 飞书 SDK 的长连接事件分发
- 先发占位卡片，再用 patch API 流式更新正文

### 10.2 QQ / NapCat 作为扩展入口

如果你更想要“生活气息”，QQ 往往更自然，因为它更像日常私聊场景。

所以建议架构上：

- 飞书先做主通道
- NapCat 作为第二阶段 channel adapter
- 两者共享同一用户身份和记忆层

### 10.3 Web / 手机看板的定位

`saki-phone` 不应该承担主对话 runtime，而应该承担：

- 新手引导
- 核心人设配置
- API 配置
- 状态面板
- 记忆浏览
- 关系时间线
- session 管理
- 提醒配置
- MCP 管理
- 模型与成本可视化

也就是说，它更像 companion OS 的控制面板。

### 10.4 面板必须优先支持的配置

对小白用户，面板第一版就应该支持以下配置卡片：

1. **核心人设**
   - 伴侣名字
   - 称呼方式
   - 核心关系设定
   - 互动边界

2. **聊天 API**
   - base URL
   - API key
   - model
   - 是否流式

3. **干活 API / Action Runtime**
   - 后端类型：托管 / OpenCode-compatible / 自定义
   - 地址或接入方式（高级模式才展开）
   - 模型/路由配置
   - 是否允许子 agent

4. **搜索 API**
   - Sonar / Grok / 其他搜索模型
   - 启用条件

5. **可选媒体 API**
   - TTS
   - 生图

6. **记忆与同步**
   - 是否启用长期记忆
   - Notion 是否启用
   - 同步频率

7. **MCP 与渠道**
   - 已启用 MCP server
   - 飞书 / QQ / Web 开关

高级用户可以展开更多设置，但默认界面只应该呈现这些。

### 10.5 飞书接入实现建议

飞书通道建议几乎原样照抄 `feishu-claude-code` 的骨架：

1. 进程启动后建立飞书 WebSocket 长连接
2. 收到消息后按用户加锁串行处理
3. 先发一张“思考中”卡片
4. 文本流到来时按 chunk patch 卡片
5. 工具调用时把进度插到卡片顶部
6. 最终保存 session、摘要和必要状态

这套交互比 webhook + 一次性回复更适合伴侣场景，因为它更像“正在和你说话”。

---

## 11. Notion 的正确定位

Notion 不是主数据库，只是外部镜像和编辑界面。

### 11.1 为什么不能把 Notion 当主存储

- API 慢
- 结构化检索弱
- 作为在线真相源成本高
- 容易把核心逻辑绑死在第三方平台上

### 11.2 正确做法

以本地 SQLite / JSONL / qmd 索引为主，Notion 为辅：

- 本地为真相源
- Notion 为浏览和人工整理视图
- 同步由独立 worker 异步执行

### 11.3 建议同步内容

- 纪念日
- 长期偏好
- 承诺事项
- 旅行/故事归档
- 每周或每月摘要

不建议同步所有原始聊天。

---

## 12. 为什么不直接照搬 nullclaw

nullclaw 值得参考，但不该整包照搬。

### 12.1 应该借鉴的部分

- 可插拔思路
- 本地轻量运行
- 混合检索记忆
- channel 抽象
- scheduler 抽象
- 工具与 runtime 分层

### 12.2 不应该直接照搬的部分

- 以“全能 agent 基础设施”为核心叙事
- 让所有能力默认常驻
- 为通用性付出过多复杂度

你的场景比它更窄，但对“长期关系感”要求更高。

所以 Aelios 应该是：

> 借鉴 nullclaw 的模块化，而不是继承它的全能野心。

---

## 13. 推荐技术选型

### 13.1 最务实版本

```text
Gateway           Node.js / TypeScript
Primary Channel   Feishu/Lark WebSocket
Secondary Channel NapCat QQ
Chat Runtime      OpenAI-compatible chat API
Action Runtime    OpenCode-compatible adapter or direct provider
Search Runtime    Sonar / Grok / search-capable API
Memory Store      SQLite + JSONL
Retrieval         Native SQLite FTS5 + vector search
Sync              Notion worker
MCP               Required in action layer
TTS / Image       Optional providers
Dashboard         复用现有 saki-phone
Scheduler         node-cron / agenda / 自建轻 scheduler
```

### 13.1.1 qmd 的新定位

`qmd` 不再建议作为主记忆后端。

更合适的定位是：

- 可选的外部知识库索引器
- 文档仓库 / 笔记仓库搜索
- agent 工作流里的补充检索能力

而不是伴侣长期记忆的主数据库。

### 13.2 API 配置模型

面向用户，系统应当明确支持 3 个必选 API 和 2 个可选 API：

**必选 3 类：**

1. 聊天 API
2. 干活 API
3. 搜索 API

**可选 2 类：**

4. TTS API
5. 生图 API

内部实现上可以统一成 `providers`，但在面板上必须按用途展示，而不是按抽象层展示。

### 13.3 用户模型偏好优先

系统不应强迫用户采用“小模型聊天，大模型干活”的默认观念。

推荐支持：

- 聊天 API 直接设为 Opus
- 干活 API 也可单独设为更强或更便宜的模型，或切换 backend 实现
- 搜索 API 独立切换
- 成本统计展示给用户，而不是替用户做决定

### 13.4 为什么网关建议用 Node.js / TypeScript

因为你现在仓库本身已经偏前端/Node 生态，复用成本最低：

- 与现有 `saki-phone` 容易整合
- WebSocket 和 HTTP 服务成熟
- 调 action backend API 和 MCP 更顺手
- 调飞书和 Notion SDK 成熟

Python 也能做，但对这个仓库的复用价值更低。

---

## 14. 建议目录结构

```text
aelios/
├── apps/
│   ├── gateway/                 # 主网关
│   └── dashboard/               # 复用或改造 saki-phone
│
├── config/
│   ├── app.config.json
│   ├── providers.config.json
│   └── channels.config.json
│
├── persona/
│   ├── persona.md               # 伴侣人设与关系风格
│   ├── boundaries.md            # 边界与禁忌
│   └── examples.md              # 可选风格示例，默认不常驻
│
├── memory/
│   ├── core_profile.md          # L1
│   ├── active_memory.md         # L2
│   ├── raw/                     # L0 jsonl
│   └── exports/
│
├── data/
│   ├── gateway.db               # sessions, events, reminders
│   ├── memories.db              # 结构化长期记忆
│   └── qmd/                     # 可选外部知识库索引
│
├── runtimes/
│   ├── chat/
│   │   └── openai-compatible.ts
│   ├── search/
│   │   └── search-provider.ts
│   └── action/
│       ├── opencode-adapter.ts
│       ├── nullclaw.ts
│       └── adapters/
│
├── services/
│   ├── router/
│   ├── memory/
│   ├── providers/
│   ├── reminder/
│   ├── proactive/
│   ├── mcp/
│   ├── notion/
│   └── retrieval/
│
├── channels/
│   ├── feishu/
│   ├── napcat/
│   └── web/
│
├── workers/
│   ├── memory-digest.ts
│   ├── notion-sync.ts
│   └── proactive-planner.ts
│
└── docs/
    ├── ARCHITECTURE.md
    ├── SETUP.md
    ├── MEMORY.md
    └── PERSONA_GUIDE.md
```

---

## 15. 关键数据流

### 15.1 普通聊天

```text
用户消息
  -> Channel ingress
  -> Session resolve
  -> Compose short context
  -> Companion Runtime
  -> 回复用户
  -> 事件写入 L0
  -> 异步判断是否值得记忆
```

### 15.2 需要读文件或网站

```text
用户消息
  -> 聊天核判断需要外部能力
  -> 生成 action request
   -> Action backend / Action Runtime 执行
  -> 返回结果摘要
  -> 聊天核组织成自然回复
  -> 必要时写入记忆
```

### 15.3 每日记忆整理

```text
定时任务触发
  -> 读取 L0 当日事件
  -> 生成当日摘要
  -> 更新 active_memory
  -> 提取长期事实写入 archive
  -> 若需要，生成 core_profile 修改建议
  -> 可选同步到 Notion
```

### 15.4 主动提醒

```text
Reminder scheduler
  -> 检查到期任务
  -> 生成提醒内容草稿
  -> 通过 channel adapter 推送
  -> 记录发送结果
```

---

## 16. Session 设计

### 16.1 原则

- session 只是短期技术容器
- 用户感知应是连续关系
- 任何 channel 切换都不应丢记忆

### 16.2 做法

- 每个 channel user 映射到一个逻辑身份 `profile_id`
- 每次对话落到某个活跃 `session_id`
- session 超长时自动轮转
- 轮转摘要进入 L2，而不是硬保留整个历史上下文

### 16.3 这样带来的好处

- 新窗不再等于失忆
- 多入口共享同一人格连续性
- token 成本可控

---

## 17. 开源分享策略

这个方案很适合开源，但要控制边界。

### 17.1 开源的部分

- 网关主体
- 通道适配器
- 记忆框架
- 定时任务框架
- 仪表盘
- persona 模板

### 17.2 不开源或由用户自填的部分

- 真实人设内容
- API keys
- 私人记忆数据
- 私有 Notion 配置

### 17.3 开源友好原则

- 提供默认伴侣模板
- 提供普通助手模板
- 提供多种 channel 样例配置
- 提供记忆迁移脚本

这样别人 fork 后，就能把它改成自己的 AI 伴侣或长期助手。

---

## 18. 实施路线

### Phase 1: 先把主干做对

- `saki-phone` 改成新手优先配置面板
- 面板支持核心人设 + 3~5 类 API 配置
- 飞书 gateway 跑通
- 聊天核接普通 chat API
- 搜索 API 独立接入
- `persona + core_profile + active_memory` 上下文拼装
- L0 事件日志写入
- 简单 session 管理
- 默认托管 action backend 接通

### Phase 2: 让记忆真正工作

- 实时轻分类器
- 每日 digest worker
- SQLite 长期记忆 + FTS5 + embedding BLOB
- BM25 + cosine weighted merge
- 记忆浏览与搜索界面
- Notion 作为可选同步开关接入

### Phase 3: 接入行动核

- OpenCode-compatible adapter 完整化
- `fetch_url` / `read_file` / `agent_task` 路由
- MCP server 管理与调用
- 结果摘要回流聊天核
- 基础子 agent 支持

### Phase 4: 主动性与生态

- 飞书主动消息
- NapCat QQ channel
- Notion 异步同步
- 提醒和纪念日系统
- 成本/用量看板

### Phase 5: 开源发布

- 模板化 persona
- 示例配置
- Docker / systemd / launchctl
- 文档与迁移脚本

---

## 19. 这套方案如何回应你的原始诉求

### 诉求 1: 记忆要好维护，不要我维护

回应：

- 用 L0/L1/L2/L3 分层记忆
- 引入实时分类器和异步整理器
- 主记忆后端采用 SQLite 原生混合检索，减少外挂组件
- 用户只在核心设定变动时做确认

### 诉求 2: tool 要全，能做 agent，但平时别乱开

回应：

- 轻聊天核默认无重工具
- 行动核按需调用 OpenCode-compatible backend / nullclaw
- 子 agent 只在复杂任务时生成

### 诉求 5: 小白要友好，最好有可视化配置

回应：

- `saki-phone` 作为配置与管理面板保留
- 面板按用途展示 3 个必选 API 和 2 个可选 API
- MCP、记忆、Notion 都做成可视化开关和列表
- 高级细节折叠，默认不要求用户理解底层架构

### 诉求 6: 飞书体验要顺滑

回应：

- 采用飞书 WebSocket 长连接而不是 webhook
- 采用卡片 patch 流式输出
- 维持 per-user session 与串行处理

### 诉求 3: 要省 token、省注意力，记忆要好

回应：

- 默认上下文极简
- 工具说明延迟注入
- 冷记忆按需检索
- session 与长期记忆分离

### 诉求 4: 要有生活气息、长期陪伴感

回应：

- 聊天核从 agent 心智中剥离
- 主动问候、提醒、纪念日、低频关心策略独立设计
- 记忆的重点从“任务记录”转为“关系连续性”

---

## 20. 最后结论

你现在最该做的，不是继续调 OpenClaw 的 system prompt，而是直接换架构。

**正确的主线是：**

- 用轻聊天核承接陪伴
- 用独立记忆核承接长期关系
- 用可替换的按需行动核承接工具与 agent
- 用独立搜索 API 承接联网搜索
- 用飞书做主入口
- 用 SQLite 原生混合检索做冷记忆内核
- 用 qmd 做可选外部知识库检索
- 用 Notion 做可选镜像
- 用 `saki-phone` 做新手友好的配置面板和移动补充界面

如果只保留一句最重要的话，那就是：

> **不要让 AI 伴侣每天都穿着 agent 外骨骼和你说话。**

这就是当前方案和 OpenClaw 路线的根本区别。