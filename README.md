# Aelios

Aelios 是一个面向长期陪伴场景的 **AI 伴侣网关**。  
它把 **聊天、记忆、工具调用、提醒、渠道接入** 拆成独立层，目标是：

- 小白也能部署
- 面板里直接配 API 和人设
- 记忆系统长期可维护
- 工具调用和渠道接入可扩展

> 这不是一个把所有东西都塞进大 prompt 的 agent 项目。  
> 它更像一个“AI 伴侣基础设施”。

---

## 功能概览

- Web 面板配置
- AI 伴侣聊天入口
- SQLite 记忆系统（FTS + 混合检索）
- 工具调用能力
  - 网页读取
  - 文件读取
  - 记忆检索
  - 提醒创建
  - 图片分析
  - MCP 调用
- 调度器（提醒 / 主动消息）
- 飞书通道
- QQ / NapCat 通道（已接入基础通道能力）

---

## 项目结构

- `saki-gateway/`：Python 网关后端
- `saki-phone/web/`：Web 面板前端（由网关静态托管）

---

## 快速开始

### 1. 安装依赖

```bash
cd saki-gateway
python3 -m pip install -e .
python3 -m pip install lark-oapi
```

### 2. 启动网关

```bash
PYTHONPATH=src python3 -m saki_gateway
```

默认地址：

- 本地：`http://127.0.0.1:3457`
- 服务器默认监听：`0.0.0.0:3457`

### 3. 打开面板

浏览器访问：

- `http://127.0.0.1:3457`

默认面板密码：

- `admin123`

然后在设置页填写：

- 基础人设
- 聊天模型 API
- 工具模型 API
- 搜索模型 API
- 飞书配置（可选）
- QQ / NapCat 配置（可选）

---

## 配置文件

主配置文件路径：

- `saki-gateway/data/config.json`

仓库中默认提交的是：

- `saki-gateway/data/config.example.json`

首次启动时，如果本地没有 `config.json`，系统会自动从 `config.example.json` 生成一份。

也就是说：

- 仓库里不会带真实密钥
- 你本地部署后会自动得到可编辑配置

---

## 面板里能配置什么

目前面板支持：

- 伴侣名字 / 伴侣身份 / 称呼 / 核心气质 / 边界
- Chat API
- Action API（工具模型）
- Search API
- TTS API
- Image API
- 飞书通道
- QQ / NapCat 通道
- 面板密码
- 调度器参数
- Session 参数

---

## 模型运行方式

Aelios 采用多 runtime 思路：

### 1. Chat Runtime

负责最终对用户说话。  
它的重点是：

- 口吻自然
- 稳定维持人设
- 最终输出给用户

### 2. Action Runtime

负责处理需要工具的消息。  
例如：

- 读网页
- 读文件
- 查记忆
- 调 MCP
- 创建提醒

### 3. Search Runtime

专门做联网搜索，不强制每次都让 Chat 模型承担搜索成本。

### 4. Media Runtime（可选）

用于：

- TTS
- 生图

---

## 记忆系统

记忆系统基于 SQLite，目标是：

- 好维护
- 好检索
- 易开源

分层思路：

- L0：原始事件日志
- L1：核心档案
- L2：近期活跃记忆
- L3：长期归档记忆

当前能力包括：

- `memories` 主表
- SQLite FTS 检索
- 事件流记录
- 面板可视化查看/管理记忆

---

## 飞书通道

面板或配置文件中需要填写：

- `channels.feishu_enabled`
- `channels.feishu_app_id`
- `channels.feishu_app_secret`

当前支持：

- 飞书 WebSocket 长连接
- 收消息
- 回消息
- 卡片流式更新
- 提醒/主动消息出站

---

## QQ / NapCat 通道

当前已接入基础 QQ 通道能力，后端基于 NapCat / OneBot v11。

当前支持：

- NapCat HTTP API 出站
- QQ 入站 webhook
- 私聊 / 群聊 route 区分
- QQ 主动消息与 reminder 统一走同一条出站链路

配置项：

- `channels.napcat_enabled`
- `channels.napcat_base_url`
- `channels.napcat_access_token`

建议使用：

- NapCat / OneBot v11
- 事件上报到网关 `POST /api/channels/qq/inbound`

---

## 常用 API

- `GET /health`
- `GET /api/config`
- `POST /api/config`
- `GET /api/providers/status`
- `GET /api/tools`
- `POST /api/tools/execute`
- `GET /api/memories`
- `POST /api/memories`
- `PUT /api/memories/{id}`
- `DELETE /api/memories/{id}`
- `GET /api/memories/search?q=...`
- `GET /api/context`
- `GET /api/reminders`
- `POST /api/reminders`
- `DELETE /api/reminders/{id}`
- `POST /api/chat/respond`
- `POST /api/chat/complete`
- `POST /api/channels/qq/inbound`

---

## 环境变量覆盖

支持通过环境变量覆盖关键配置，例如：

- `SAKI_HOST`
- `SAKI_PORT`
- `SAKI_CONFIG_PATH`
- `SAKI_CHAT_BASE_URL`
- `SAKI_CHAT_API_KEY`
- `SAKI_CHAT_MODEL`
- `SAKI_ACTION_BASE_URL`
- `SAKI_ACTION_API_KEY`
- `SAKI_ACTION_MODEL`
- `SAKI_SEARCH_BASE_URL`
- `SAKI_SEARCH_API_KEY`
- `SAKI_SEARCH_MODEL`
- `SAKI_FEISHU_ENABLED`
- `SAKI_FEISHU_APP_ID`
- `SAKI_FEISHU_APP_SECRET`
- `SAKI_NAPCAT_ENABLED`
- `SAKI_NAPCAT_BASE_URL`
- `SAKI_NAPCAT_ACCESS_TOKEN`
- `SAKI_DASHBOARD_PASSWORD`

---

## 安全说明

- 仓库中**不包含真实 API key / 飞书 secret / 本地 config**
- 运行时数据库和日志已加入 `.gitignore`
- 默认面板密码仅用于首次启动，请尽快修改
- 如果公网部署，请务必放在 HTTPS / 反向代理后面

---

## 本地运行数据（不会提交）

这些文件是本地产物，不应进入仓库：

- `saki-gateway/data/config.json`
- `saki-gateway/data/*.db`
- `saki-gateway/data/*.db-shm`
- `saki-gateway/data/*.db-wal`
- `saki-gateway/data/raw/`
- `saki-gateway/data/active_memory.md`
- `saki-gateway/data/core_profile.md`

---

## 适合谁

如果你想要的是：

- 一个能长期陪伴的 AI 伴侣网关
- 面板里直接配置就能用
- 有记忆系统
- 有工具调用
- 后续还能接飞书、QQ、提醒、MCP

那这个项目就是给你准备的。

---

## 许可

如需公开正式发布，请按你的需要补充 License 文件。
