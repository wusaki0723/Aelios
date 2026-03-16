# saki-gateway

恋爱网关后端服务，提供聊天、记忆、日志、提醒与内置 Web 面板。

> 这个公开仓库已经做过脱敏处理：
> - 不包含任何真实 API key / token
> - 不包含真实 persona、长期记忆、聊天日志、数据库
> - 不包含用户导入的数据与运行时缓存

## 功能概览

- 聊天与上下文组装
- 长期记忆管理
- 每日日志生成与查看
- 基于今日日志整理长期记忆
- 提醒与事件记录
- Web 面板 API
- 仓库内置静态面板资源，可直接开箱运行

## 项目结构

```text
src/saki_gateway/
  server.py        # HTTP API 与主逻辑
  memory.py        # 记忆存储层
  runtime_store.py # 会话、提醒、事件存储
  static/          # 内置前端面板静态文件

data/
  config.example.json
  active_memory.md
  core_profile.md
  raw/events.jsonl
```

## 运行要求

- Python 3.11+
- 已配置可用的大模型 API

## 快速启动

```bash
git clone https://github.com/wusaki0723/Aelios.git
cd Aelios
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
cp data/config.example.json data/config.json
```

然后编辑 `data/config.json`，填写你自己的：

- 模型 API 地址与 API key
- 飞书 / QQ Bot / NapCat 配置
- persona 示例内容
- 面板密码哈希

启动：

```bash
python -m src.saki_gateway.server
```

或者使用已安装脚本：

```bash
saki-gateway
```

默认端口：`3457`

## 首次配置说明

### 1. 配置模型 API

至少填写：

- `chat_api.base_url`
- `chat_api.api_key`
- `chat_api.model`

如需记忆整理、工具调用或搜索，再补充：

- `action_api.*`
- `search_api.*`

### 2. 配置 persona

仓库里只保留了示例 persona。请按自己的需求修改：

- `persona.partner_name`
- `persona.partner_role`
- `persona.call_user`
- `persona.core_identity`
- `persona.boundaries`

### 3. 配置面板密码

`dashboard_security.password` 需要替换成你自己的密码或哈希值。

### 4. 第三方通道

如需启用飞书、QQ Bot 或 NapCat，请填写你自己的：

- App ID
- App Secret / Token
- 对应回调地址

## 数据目录说明

以下内容属于运行时数据，不建议提交：

- `data/config.json`
- `data/*.db`
- `data/*.db-shm`
- `data/*.db-wal`
- `data/raw/events.jsonl`
- `.run/`

仓库中保留的 `active_memory.md`、`core_profile.md`、`events.jsonl` 仅为示例或空文件，方便 clone 后直接启动。

## 面板访问

启动后访问：

- `http://127.0.0.1:3457/`

静态文件由后端从 `src/saki_gateway/static/` 提供。

## 开发说明

如果你要更新面板资源，可以从原前端目录同步到仓库内静态目录：

```bash
rsync -a --delete --exclude='*.bak-*' /path/to/saki-phone/web/ src/saki_gateway/static/
```

## 安全提醒

请不要把以下内容提交到公开仓库：

- 真实 API keys
- 真实聊天记录、长期记忆、persona
- 导出的 worldbook / notion 数据
- 任何包含个人域名、账号 ID、群 ID、用户 ID 的文件
