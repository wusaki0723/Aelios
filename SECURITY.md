# Security Policy

Aelios stores people's conversations and long-term personal memories. Those are about as private as data gets, so security reports are taken seriously and handled first.

## Security contact

Aelios is maintained by **@wusaki0723** (who also commits as **@sakisakisa-design**). Security reports go to the maintainer directly.

## Reporting a vulnerability

Please **do not open a public issue** with details.

1. Go to the repository's **Security** tab and click **Report a vulnerability**. This opens a private advisory that only you and the maintainer can see.
2. If that button is missing, open a public issue titled `Security contact request` with no details, and a private channel will be set up with you.

A good report says what an attacker can do, which endpoint or file is involved, and the steps to reproduce it on a fresh deployment.

What to expect:

- A reply within 7 days.
- Confirmed issues are fixed on `main` first, then disclosed in a GitHub Security Advisory that credits you (unless you'd rather stay anonymous) and tells self-hosters how to update.
- Every Aelios runs on its owner's own Cloudflare account, so a fix only reaches people after they sync their fork. Advisories always include the update steps and, when a key may have leaked, the rotation steps.

## Supported versions

Only the latest `main` is supported. If you deployed from a fork, **Sync fork** on GitHub and Cloudflare redeploys automatically (see [Updating](README.md#updating-to-the-latest-version)).

## Scope

In scope: everything in this repository.

- The Worker: the gateway (`/v1`, `/<assistant>/v1`), `/mcp`, `/api/*`, the `/admin` panel and its API
- The deploy and setup scripts in `scripts/`
- The Claude Code hook in `integrations/`

Examples of what we want to hear about:

- Getting past API key checks, or a narrower key reaching something it shouldn't (for example a `MEMORY_MCP_API_KEY` changing owner-only settings)
- Reading or writing another assistant's memories
- Script injection in the admin panel
- Secrets ending up in git, logs, or stored memories
- Prompt injection that plants instructions in stored memories so they replay into later conversations, or that makes the assistant leak memories
- Deploy scripts that expose credentials (this happened once: see below)

Out of scope:

- Cloudflare's platform itself (report to Cloudflare) and the model providers behind the gateway
- A deployment whose owner chose a weak key or leaked it
- Load or denial-of-service testing against `workers.dev`
- Social engineering

**Only test against a deployment you own.** Never probe someone else's Aelios or open anyone's real memories.

## Past security fixes

- **June 2026, [#7](https://github.com/wusaki0723/Aelios/issues/7) → [#9](https://github.com/wusaki0723/Aelios/pull/9)**: the setup script wrote secrets such as `CHATBOX_API_KEY` and `CLOUDFLARE_API_TOKEN` into the git-tracked `wrangler.toml`. Fixed two days after the report. [SECRETS.md](SECRETS.md) walks affected forks through rotating the keys first and cleaning git history second.

## Running your own Aelios safely

- Every `*_KEY` and `*_TOKEN` is a Cloudflare **Secret**, never a Variable. Details in [SECRETS.md](SECRETS.md).
- Make `CHATBOX_API_KEY` long and random (for example `openssl rand -base64 32`), not a phrase someone could guess.
- `CHATBOX_API_KEY` is the owner key: it can change settings. Give other clients their own keys: `MEMORY_MCP_API_KEY` for MCP connectors, `IM_API_KEY` for IM bots, `GUIDE_DOG_API_KEY` for image descriptions. None of them can change settings, and a key can only chat through an assistant whose **Keys** list includes it.
- A connector address with `?token=` is saved by the client and can show up in logs. Prefer `MEMORY_MCP_API_KEY` there, and rotate the key if the address is ever shared.
- If a key leaks, replace the Secret in Cloudflare first, then clean up wherever it leaked.
- Your data lives in your own D1 database and Vectorize index. Aelios sends nothing to the maintainer; the Worker only talks to Cloudflare, the model upstream you configure, and GitHub if you turn on the optional daily archive.

---

## 中文简版

Aelios 存的是对话和长期记忆，是最私密的那类数据，安全问题优先处理。

- **报告漏洞**：别在公开 issue 里写细节。到仓库 **Security** 页点 **Report a vulnerability** 私下提交；没有这个按钮就开一个标题为 `Security contact request`、不写细节的 issue，维护者会另开私密渠道。
- **维护者**：@wusaki0723（也用 @sakisakisa-design 提交），7 天内回复。确认的问题先在 `main` 修好，再发 Security Advisory 并写明自部署怎么更新；只支持最新 `main`，fork 部署的点 **Sync fork** 就会自动重部署。
- **只在你自己的部署上测试**，不要碰别人的 Aelios 和任何人的真实记忆。
- **自部署安全**：所有 `*_KEY`、`*_TOKEN` 都设成 Secret（见 [SECRETS.md](SECRETS.md)）；`CHATBOX_API_KEY` 是主钥匙、能改设置，要长要随机；给 MCP 连接器、IM bot 各用自己的钥匙（`MEMORY_MCP_API_KEY`、`IM_API_KEY`，都不能改设置，没勾进助手的 Keys 就不能借它聊天），带 `?token=` 的地址会被客户端保存、可能进日志，分享过就换钥匙；钥匙泄漏先换钥匙再清理。
