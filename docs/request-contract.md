# 请求契约与 thinking 边界

协议快照核对日期：2026-09-07。实现入口为 `src/gateway/request.ts`。

## 处理顺序

鉴权和身份选择 → 按协议净化 → 主模型 thinking 策略 → 合法性预检 → 兼容缓存转换 → 原文记录/召回 → 注入 → 最终出站校验 → CF。
本地预检失败返回协议形状的 400，例如 `messages.2.content: tool_use_id must match ...`，不会先入库或调用上游。
原始请求用于会话指纹和原文记录：`metadata.session_id` 可用于区分会话，但不会作为非规范 Anthropic metadata 发到上游。

## 白名单边界

- 三种协议各自维护顶层字段名单，不在名单中的客户端杂项不转发。更新 SDK/采用新顶层扩展时，需要同步名单。
- Anthropic 进一步处理消息包装、已知内容块、thinking、output_config、metadata、客户端工具定义、缓存对象。
- `output_config.effort/format`、`thinking.display` 是合法字段，保留；顶层 `display` 是杂项，删除。
- JSON Schema、工具 input、服务端工具结果、引用和加密数据是业务/协议数据，不用顶层白名单递归清洗。
- 未知内容块返回带路径的 400，避免静默删除一段历史。thinking/redacted/compaction 等 opaque 历史出现未知字段也拒绝，不改写签名内容。
- 版本化服务端工具定义及其内部 payload 保留原结构；没有在本地完整重建所有 beta、所有 Provider 的 schema。
- Chat/Responses 本轮只净化顶层 envelope；其原生工具、消息和 reasoning 内部结构继续透传。

契约校验涵盖必填字段和类型、消息角色/内容、普通工具调用与结果配对/顺序、重复调用 ID、JSON Schema 基本形状、缓存数量/TTL、thinking budget/tool choice、beta binding、常见输出设置。
它不做 JSON Schema 内容的完整验证，不计算模型 token 上限，也不在本地验签。
顶层白名单依据的是 Anthropic 官方协议，不是假定的 Vertex 子集；官方合法但具体上游不支持的能力仍可能报错。
尤其 `custom-*` 线路的背后服务无法从请求可靠推断；不因为名字像 Claude 就删除用户选择的 effort 或输出格式。

## Thinking 审计矩阵

| 情形 | 召回/注入 | 思考历史及出站策略 |
| --- | --- | --- |
| 主模型、人类输入、默认 auto，原生 Anthropic 线路 | 单次注入 | 客户端写了 enabled/adaptive：同 drop_block。未指定：历史有思考块且没带 temperature/强制工具才补 adaptive+绑定，上游拒了按原样重发一次；否则不动 |
| 主模型、人类输入、auto 走其他线路或 passthrough，thinking 开启或未指定 | 单次注入 | 历史不变；补丁只进本轮 user 尾部,实测 Vertex 默认不校验前缀绑定 |
| 主模型、显式 disabled、人类输入 | 单次注入 | 不强行启用 adaptive，不自动加 beta；已有失配历史仍可能报错 |
| 主模型、人类输入、drop_block | 单次注入 | 保留 enabled/adaptive 参数，合并 binding 和 beta |
| 纯 tool_result 续轮 | 不召回、不恢复旧补丁 | drop_block（含 auto 走原生线路）设置仍发送；历史所有块顺序不变 |
| tool_result 后有独立用户文本 | 按新用户输入召回 | 记忆追加在结果和用户文字之后，不插到结果前 |
| 多次工具调用、分开的连续同角色消息 | 不重排消息 | 按 Anthropic 合并后的逻辑回合校验配对 |
| 多轮签名、空 thinking、redacted thinking | 不删除、不改写 | 本地检查必要字段；真实性及前缀绑定由上游验证 |
| 客户端压缩/换 system/换工具/换模型 | 不恢复影子历史 | passthrough 不保证旧签名有效；drop_block 依赖线路支持 |
| 非主模型 | 无召回、无记录 | 净化和结构校验仍执行，身份策略不启用 thinking |

`drop_block` 只让上游丢弃失配的块及受其影响的后续块，不是网关删除全部 thinking。
它会牺牲部分推理连续性。用户改回 passthrough 或 disabled 后，先前已失配的历史不会自动恢复。
原生 Anthropic 线路默认强制校验前缀绑定（2026-10-08 用 Opus 5.5 实测），所以默认的 auto 在这条线路上按 drop_block 处理。
其他线路如果也开始强制校验，应改 drop_block 或显式 disabled；本版不维护注入补丁状态。

## 验证范围

`npm run test:gateway` 运行实际 Worker/SQLite 路径与独立契约测试，覆盖跨空间来源/预算/写入、无效请求零写入、工具循环、签名块保留、混合输入、缓存与 beta。
外部 HTTP 使用 mock，不能用测试通过宣称 Vertex/Anthropic 的验签或全部模型能力已经端到端验证。

官方依据：

- [Messages 请求参数](https://platform.claude.com/docs/en/api/messages/create)
- [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
