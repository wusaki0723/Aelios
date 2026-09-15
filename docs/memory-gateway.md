# Aelios 记忆网关（开发分支）

Aelios 负责身份、临时召回和自动记录，客户端 Harness 负责工具循环。

管理面板顶部可以选择助手，默认查看该助手的写入空间，也可在第二个下拉框中查看它的召回空间。共享空间单独查看，不把多份库混成一个列表。首次打开会尝试匹配之前查看的空间，否则从默认空间切到第一个助手；已手动选择的旧库会保留。未配置的空间可在「高级：手动指定空间」中输入。

面板的选择只影响浏览和管理记忆，不会修改客户端身份路由或助手的写入/召回配置。切换空间会清空旧列表和编辑状态，刷新当前页面，并忽略旧空间迟到的列表响应。
上游只有一个:Cloudflare AI Gateway(BYOK 走 gateway 面,REST 只花 Unified 额度),一把 CF token 管所有,无需 LiteLLM。

## 分工

| 组件 | 工作 |
| --- | --- |
| Worker | 原生协议入口、身份解析、主模型记忆追加、流式字节透传 |
| CF AI Gateway | Provider 识别(`author/model`)、BYOK 计费、限流、日志 |
| CF Dynamic Routes | 预算、路由与 fallback（在 CF 侧配置，本网关不实现） |
| Workers AI | embedding、reranker、默认 Dream 模型 |
| Vectorize | 按 namespace 检索长期记忆 |
| D1 | 配置、原始可见对话、记忆、去重记录 |
| Queue | 异步记录，失败重试，重复投递幂等 |
| Cron | 对各记录身份的 namespace 运行 Dream、日记与留存清理 |

本轮没有引入 Agents SDK / 自建 loop，也不做三协议之间的转换。
每个协议通过下文的 BYOK 路由访问 CF 对应端点；不再使用消耗 Unified 额度的 REST `/ai/v1` 地址转发聊天。
模型名原样透传，厂商识别交给 CF 的 `author/model` 命名；选错厂商由 CF 报错。

## 配置模型

配置只有三层，全部在 `/admin` 的「设置」里完成：

1. **连接**：CF 账号 ID（或完整地址）。token 不放面板，放 Worker Secret `CLOUDFLARE_API_TOKEN`。
2. **助手**：每位三格——名字（slug，即 URL 路径段）、主模型列表、可用钥匙。
   写入空间 `namespace` 默认同名；可另设 `readNamespaces` 召回空间列表。
3. **环境设置**：`settings` 白名单里的运行参数，面板直接改，覆盖部署默认值。

主模型白名单是唯一的记忆开关：**只有主模型的对话召回记忆、进入 Dream；其余模型安静透传**。
匹配容忍 `author/` 前缀，支持 `*` 通配（如 `*fable*` 同时认 `claude-fable-5-1` 和 `anthropic/claude-fable-5-1`）。
这样 Claude Code 的 haiku 小模型、Codex 的杂务模型天然不沾记忆，不需要维护黑名单。

配置优先级：D1 保存的配置 > Worker `GATEWAY_CONFIG` JSON 变量 > 空配置。
空配置的模型列表为空，聊天请求返回配置提示。
`GET /v1/models` 透传上游模型目录：CF 账号走 AI Gateway 的 compat 目录（`gateway.ai.cloudflare.com/v1/{账号}/{网关}/compat/models`，REST 无 GET /models），自定义地址走 `{base}/models`；上游答不上或无 CF token 时回落为主模型白名单提示。

聊天协议路由(仅 CF 上游;自定义地址原样透传):chat 走 `…/{网关}/compat/chat/completions`(全 provider,BYOK);messages 走 `…/{网关}/{provider}/v1/messages`,responses 走 `…/{网关}/{provider}/v1/responses`(openai 特例无 v1),模型名剥掉 provider 前缀,CF token 以 `cf-aig-authorization` 头携带;provider 不认的协议由上游如实报错。无前缀的模型名网关内直接 400,不打上游。
管理配置允许 `CHATBOX_API_KEY` / `DEBUG_API_KEY`。旧 MCP 与记忆管理权限不变。

## 首次配置

1. 使用 `feat/memory-gateway` 分支，运行 `npm ci`。测试需要 Node.js 22+。
2. 按原部署流程创建 D1、Vectorize 和 Queue，应用全部 migrations，包含 `0012_memory_gateway.sql`。
3. Worker Secrets 只放两把钥匙：`CHATBOX_API_KEY`（自己编的，进面板用）和 `CLOUDFLARE_API_TOKEN`
   （使用现有 AI Gateway token 权限配置；第三方 Provider 密钥在 CF BYOK 面板管理）。
4. 打开 `/admin`，填 CF 账号 ID，添加助手（比如 `coder`），保存。
5. 客户端按助手接入：

| 客户端 | 配置 |
| --- | --- |
| Chatbox 等 OpenAI 兼容 | base URL `https://<host>/coder/v1`，填 `CHATBOX_API_KEY` |
| Claude Code | `ANTHROPIC_BASE_URL=https://<host>/coder`，token 同上 |
| Codex | `base_url = "https://<host>/coder/v1"`，`wire_api = "responses"` |

不带助手名的 `/v1/...` 走该钥匙的第一个助手，方便只配一个的时候用。
轮询和多 key 池需要时自行部署 new-api 之类的上游，把它的地址填进「连接」即可——配置模型不变。

## 临时记忆生命周期

| 入口 | 新输入 | 工具续轮 |
| --- | --- | --- |
| `/v1/chat/completions` | 最后一项 user | role=tool 不召回 |
| `/v1/messages` | 最后一项 user，非纯 tool_result | tool_result 内部文字不是用户原话 |
| `/v1/responses` | 字符串 input 或最后一项 user message | function_call_output 等输出不召回 |

纯图片仍原样转发，没有文本 query 时不召回。tool_result 旁有独立 text 块时，按新的用户指令处理。
各记忆来源（普通记忆、珍贵、黑话、证据原话、日记印象）和已授权的召回空间统一产生候选，由一次最终选择决定注入。日常合计最多 1 条联想，回答旧事最多 2 条；`MEMORY_FILTER_MAX_OUTPUT` 可进一步收紧或设为 0。珍贵不会自动占据注入位置。原文提取成不超过 400 字的连续窗口，程序按选择编号摘取，附「相关旧事，可自然提及，不作当前事实」或「回答旧事」用途；所有来源共用身份的字数预算。完整窗口放不下时跳过，继续尝试后面的条目。ID 和来源只留在管理记录中。显式 MCP / REST 搜索仍返回完整记录和 ID，不套自动注入预算。

默认自动召回不调用生成式 LLM：向量＋词面提名候选，所有来源/空间汇合后，用 Worker 的 `AI` 绑定调用 `@cf/baai/bge-reranker-base` 一次批量重排。重排看到的是将要引用的原文片段（原话会附说话人），不再先截整条记忆的前 240 字打分、再另选摘句。网关跳过原来的整条记忆重排，显式 MCP / REST 搜索保持原有流程。最多 16 条候选、每条 4 个片段，总计不超过 64 个；候选提名仍有词面和数量限制，未进入池的记忆无法靠最后重排找回。

`/admin → 设置` 可以调整：

- `MEMORY_RERANKER_MODEL`：默认上述 Workers AI 模型，也接受 `workers-ai/@cf/...` 前缀。缺失、关闭或调用失败时，回落词面 top-1，不补调 LLM。
- `RECALL_RERANK_MIN_SCORE`：默认 **0.25，只是未经线上校准的起点**。分数是该模型的原始相关分数，不是事实正确率；换模型应重新观察分布。低分不强取第一条。
- `RECALL_RERANK_TIMEOUT_MS`：默认 1500 毫秒，上限 5000。超时丢弃迟到结果并改走词面；Workers AI 绑定不支持 AbortSignal，请求可能仍完成并计费。

规则统一处理已在可见历史的片段、重复内容、日常 0–1 条和旧事参考最多 2 条；同空间共享来源 ID 的多条候选本次只呈现一条。同空间同一 `fact_key` 取相关分最高的一条，不整组作废。来源不足时无法可靠识别所有改写重复；不靠相似度删除库里的记录。

短记录不拆句；长记录选连续原文并带前一句。带前句仍超过 400 字的片段会跳过。重排只判断相关性；日记印象不作为事实答案。“最近一次/哪天”这类要排事件顺序的问题不自动注入；闲聊里提到“最近”仍可联想。主动搜索仍可取完整证据。

### 触发器联想召回（默认关闭）

现有召回是描述性的：问题和记忆在字面或向量上像，才召得回来。问题和记忆语义相关但几乎不共享词汇时，第一跳就是空的——而 `RELATION_EXPANSION` 是从已召回的种子往外走的出口扩展，种子为空时它也无从展开。

触发器通道补的是入口这一头。写入期给每条记忆挂几个触发器：要么是沿 is-a 阶梯往上一两级的语义锚点，要么是「提到它就大概率该想起这条记忆」的强关联场景；每条触发器附一句 bridge，写成 `<记忆里的线索> -> <一步推理>`，bridge 自己也进检索。召回时先查触发器索引，命中的触发器把它挂的记忆并进候选池，之后和别的候选一样过重排和地板分。

三个设计上的硬约束，改之前先想清楚：

- **门限很高（默认 0.85，只能往上调）**。这条通道不承担主要召回，它只在几乎可以肯定的时候补一刀。调低就开始往候选池灌噪音，而池子后面的重排和地板名额有限，噪音是要挤掉真命中的。
- **只增不减**。触发器只往候选池里 union，不改已有命中的分数和顺序。`TRIGGER_RECALL` 关着时，召回结果和没有这个功能时逐字一致。
- **触发器向量的 namespace 一律带 `trg:` 前缀**。它和记忆向量共用 `memo-kb` 索引，靠这个前缀和记忆召回隔离——`searchVectorMemories` 有一条不带 filter 的 legacy 查询兜底迁移期向量，只靠 `metadata.namespace` 严格相等来挡。去掉前缀等于把触发器直接漏进记忆召回结果里。

一条触发器写三个向量：concept、bridge、两者拼接。召回时按触发器取三者里的最高分，三个角度只要有一个对上就算命中，不会被另外两个不像的拉平。

建期在夜批里跑（`TRIGGER_BUILD`），只建增量——已经有触发器的记忆跳过，一夜最多 120 条。成本是每条记忆一次模型调用加三次向量化，所以模型别用太小的，触发器质量直接决定这条通道有没有用。记忆被删除时挂着的触发器一起摘掉。

相关开关：`TRIGGER_RECALL`、`TRIGGER_RECALL_GATE`、`TRIGGER_RECALL_TOP_K`、`TRIGGER_BUILD`、`TRIGGER_BUILD_MODEL`。表结构见 `migrations/0016_memory_triggers.sql`。

思路借鉴 T-Mem（EMNLP 2026，trigger-augmented retrieval）的 entity/bridge 触发器与三视图召回；这里只取了单条记忆粒度的那一半，没有引入它的 scene/horizon 层和场景图。

`/admin → 设置` 的「为什么想起这件事」可按助手查看最近 20 次召回、候选摘句、选择理由、原始相关分数、分数下限、重排与筛选耗时、最终是否注入，以及空结果/错误。数据来自 `memory_events` 中的 `recall_explain`；`GET /api/gateway/recalls?identity=名字` 仅限主钥匙或维护钥匙。两个助手即使共用写入空间，记录也按助手过滤。旧日志缺少新字段时仍能查看。

原话引用只在证据问题（暗号、原话、说过、哪天）打开；日常闲聊不扫 messages。所有来源都过滤已在请求历史里的同文窗口，重复候选只保留一份。上下文压缩移除的旧话可以再次召回。库里若本来就是归档摘要，摘出的仍是已存文字，不能恢复最初聊天措辞。

工具续轮不搜索、不恢复旧补丁，下一个人类输入重新判断；原有 system、工具、历史块和 cache_control 不变。没有补丁缓存；重试可能再次搜索，写入按指纹去重。

夜间抽取继续沿用现有审核流程，补充“一条围绕一件事、相邻来源合并、主体和状态清楚、来源 ID 不写正文”的要求。这里只改抽取指导，不自动批量改写旧库；原有事件和版本链继续保留。

客户端消息若带 `<message from="…" msg_id="…">正文</message>` 或 `<wecom-message …>` 一类传输信封，只保存和检索正文；哈希、msg_id 不进召回词。客户端注入的 `<recap>`、`<system-reminder>` 以及「User stepped away; returning. Recap:」这类一看就不是用户发言的整段直接丢掉：不当成人类轮、不入库、不召回。助手侧「已回她。」一类回执同样丢掉；模型生成的工具调用（任何工具，不限微信）会作为助手发言进库，工具返回仍不进。普通散文里写 `<message>`、「帮我写个 recap」或「我跟她说已回她了」不受影响。旧数据无需先迁移，召回和夜间整理读取时也会清洗。相同会话中，最高分命中只和它时间上直接相邻、且间隔不超过 90 秒的句子合成一个事件；不会顺着 90 秒窗口把整段连续对话收成一条。源消息 ID 仍保留在内部 trace。

如果第一响应只调用工具，后续最终回复可能不再看到记忆。“阅后即焚”不表示清除已经产生的模型影响、加密推理或上游日志。

### 共享和迁移空间

旧 v3 配置无需迁移数据库：`namespace` 继续表示唯一写入空间，省略时使用 slug。
`readNamespaces` 省略时只读写入空间；显式数组表示**完整召回名单**，不自动补上写入空间；`[]` 表示只记录、不召回。
最多 8 个唯一空间，只能在管理配置中设置，请求体、请求头都不能覆盖。

```json
{
  "slug": "coder",
  "keys": ["CHATBOX_API_KEY"],
  "models": ["*opus*", "*sonnet*"],
  "namespace": "coder",
  "readNamespaces": ["coder", "coder-old", "shared-docs"]
}
```

多个助手可以读同一空间，也可写同一空间。迁移时让新对话写新空间，召回保留旧空间；这里不搬移 D1 行或 Vectorize 索引。
每个空间独立检索，同类候选轮流合并、同类型同内容去重，最后统一执行一次条数/字数预算。
一个空间失败仍可用其他空间，全部失败报告召回不可用；trace 列出失败空间。
注入计数回写条目所属空间，`recall_explain` 存在写入空间，记录每条来源空间。
授权某助手读取共享空间，意味着该助手的所有可用钥匙都可召回其内容。
Cron 继续维护配置的写入空间，避免只读共享关系无意触发另一个空间的 Dream。

### Anthropic thinking

- `passthrough`（默认）：不修改 thinking，记忆照常注入。召回片段只追加在最后一轮 user 消息尾部，
  不改历史块。实测 Vertex 线路默认不校验 thinking 的前缀绑定(补丁下轮消失,旧签名块仍 200),
  只有客户端显式携带 `block_binding` 时前缀才进入签名范围。
- `drop_block`：在每次请求（含工具续轮）合并 `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`，
  以及 `thinking-binding-controls-2026-08-01` beta header。仅适用于支持该 beta 的线路，会牺牲部分思考连续性。
- 显式 `thinking.type: "disabled"`：直接临时注入，不添加该 beta。
- 注意:`drop_block` 依赖上游认识 `block_binding` 字段;Vertex 线路会直接 400 `unrecognizedProperty`,勿用于 Vertex。
- 非主模型不自动启用 thinking，不自动添加 binding 设置。

本地只能验证结构，不能验证厂商的加密签名。历史签名块、空 thinking 文本、redacted data 原样保留。
切换到 disabled 不会修复之前已经失配的历史；更换线路、压缩、修改工具或 system 造成的失配也由上游判断。
完整审计矩阵、协议白名单范围见 [请求契约与 thinking 边界](request-contract.md)。

### Responses 状态

主模型请求强制 `store:false`，要求完整显式历史；含 `previous_response_id`、`conversation`、
`item_reference` 时返回 400，避免服务端隐藏历史继续携带补丁。
非主模型不做此检查：纯透传，服务端状态原样通过，不召回也不记录。
`reasoning.encrypted_content` 原样通过，不能承诺加密推理里不含记忆影响。

本版支持 HTTP POST + SSE，没有实现 WebSocket、Responses GET/DELETE、后台任务轮询、`/responses/compact`、
Anthropic token counting。使用这些额外端点的客户端需要后续适配；还不能声称 Claude Code / Codex 全功能兼容。

## 自动记录与辅助请求

主模型对话的原始新用户文本、可见助手回复和模型发出的工具调用（tool_use / function_call 参数）进入 messages 表，供 Dream 使用，无需 Hook。thinking、工具返回不入库。Chat Completions 记录第一个 choice。像「已回她」「已发送」这种回执整句丢掉——发出去的正文在对应工具参数里。旧回执读取时也会洗掉。
`gateway_exchanges` 保存操作状态、实际模型/Provider 和可见文本，不保存注入补丁。

- 同一请求重试、Queue 重复投递：稳定指纹 + D1 主键去重。
- 更长历史中再次说相同文字：视为新消息。
- 每个输入/输出记录最多 8000 字符，超限为 truncated，不把截断对话当作完整 Dream 来源。
- 中断、取消、失败：不完整助手输出不进入 Dream。
- 无 Queue 或发送失败：直接写 D1，最终错误记录日志。
- exchanges 与 messages 共用 `MESSAGES_RETENTION_DAYS`。

| 可选请求头 | 用途 |
| --- | --- |
| `x-aelios-session-id` | 区分会话；也读取 session_id、x-session-id、metadata.session_id |
| `x-aelios-request-id` | 区分内容相同但有意重新生成的请求 |
| `x-aelios-purpose: auxiliary` | 标题、压缩、内部任务：不召回，不进入 Dream |

没有 session ID 时，在身份与来源下按完整输入去重；两个全新会话若历史完全相同，会合并为一次输入。
无法可靠识别未标记的机器内部任务；把杂务模型留在主模型白名单之外即可。

持久化在响应结束后调度，不是在返回客户端前确认写入；运行时强制终止仍可能丢失末尾记录。

## Fallback 与缓存

重试、跨厂商 fallback、预算与限流全部交给 CF AI Gateway（动态路由在 CF 仪表盘配置）。
本网关一次调用一个上游，本地不做主备。
旧 assembler、缓存断点/滚动缓存已退出对外入口。新网关不重排前缀，也不添加 prompt cache 断点：
召回内容追加在对话末尾，各家自己的 prompt 缓存照常命中。
顶层 `cache_control` 是 Anthropic 已支持的自动缓存字段，但部分 Vertex/代理线路仍会拒绝。
为兼容现有线路，网关把它转换成注入前最后一个可缓存块上的显式断点；已有断点保留，TTL 冲突或超过 4 个提前返回 400。
没有顶层缓存设置就不主动添加断点。这个转换不等于保证所有上游支持同一套特性。
工具定义上的未知字段同理,网关按「学习」处理:某条线路 400 报 `unrecognizedProperty=<字段>`,
剥掉该字段重试,并在本 isolate 按线路记住,之后请求预先剥除;支持该字段的线路永远学不到,不受影响。
实测两种:Vertex 线路拒绝工具级 `cache_control`(system/user 位置正常);新版 Claude Code 会给每个工具
带 `eager_input_streaming`,中转层和 Bedrock 之类不认,也走同一条学习路径 —— 该字段只调工具参数流式粒度,
剥掉只损失一点延迟。一次 400 只报一个字段,客户端可能同时带多个,所以学习放在有界循环里,首轮最多每种字段多花一次往返。
想不等这一次 400、每次先剥干净,在「设置 → 模型与线路」填 `UPSTREAM_STRIP_TOOL_FIELDS`(逗号分隔)。
默认留空:那是按线路精确剥,只会影响真正拒绝它的上游,比一刀切剥所有 custom provider 更准。
这个设置是自由文本,但工具的身份字段(`name`/`description`/`input_schema`/`type`)会被拒绝并记一条日志 ——
`validateRequest` 在剥离之前,否则会拆坏工具再出站。
响应头 `x-aelios-identity/memory/provider/model` 用于诊断；实际模型与 Provider 优先读取 `cf-aig-model/provider`。
`x-aelios-normalized` 表示删除的非规范字段数量，Worker 日志列出字段路径，不记录被删除的值。

## 验证与下一步

```bash
npm ci
npm run verify
npx wrangler deploy --dry-run
```

网关测试调用生产 TS 模块和实际 SQLite migrations/SQL，只替换外部 HTTP 调用。
覆盖三协议、主模型白名单、临时召回、去重、身份隔离、辅助请求、SSE Unicode 分块、中断与 Queue 回退。
这是本地验证，不等于已经在真实 CF、Claude Code 或 Codex 中跑过端到端会话。

后续联调优先级：真实三协议线路 → Claude thinking beta 透传 → 客户端工具续轮 → 辅助请求识别 → 更多协议端点。
每完成一个可验证阶段即提交开发分支，不等整轮联调完成。main 不合并、不部署。

## 官方依据（2026-09-06 核对）

- [CF REST 三协议](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
- [CF Dynamic Routes](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/)
- [Anthropic preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)

旧 `/admin/gateway` 页面已废弃，仅跳转到 `/admin`；网关设置与召回记录共用主面板的助手选择和 Token。
