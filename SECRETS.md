# Secrets & 配置变量：怎么正确部署 Aelios 的密钥

这篇文档写给两拨人：

- **正在第一次部署的姐妹**：照「新部署」那段做，5 分钟。
- **已经 fork 并部署过、但用了老 setup 的姐妹**：照「老 fork 迁移」那段做，先检查 wrangler.toml 有没有被写入密钥，再决定要不要 rotate。

---

## 1. 一秒钟看懂：哪些是 Secret，哪些是 Variable

Cloudflare Worker 的「Variables and Secrets」面板里，**Variable** 是明文、会被写进 `wrangler.toml`、git tracked；**Secret** 是加密、只在 Cloudflare 端存、永远不进 git。

| 名字 | 类型 | 用来干嘛 |
|---|---|---|
| `CHATBOX_API_KEY` | **Secret** | 客户端和管理面板的访问密钥 |
| `MEMORY_MCP_API_KEY` | **Secret** | 纯记忆库 MCP 的访问密钥（可选） |
| `GUIDE_DOG_API_KEY` | **Secret** | 导盲犬 API 的访问密钥（可选） |
| `IM_API_KEY` | **Secret** | 第二把钥匙，IM bot 用（可选） |
| `DEBUG_API_KEY` | **Secret** | 调试接口钥匙（可选） |
| `CF_AIG_TOKEN` | **Secret** | AI Gateway 调用 token（接网关才需要） |
| `CLOUDFLARE_API_TOKEN` | **Secret** | Cloudflare API Token，部署脚本用它建 D1/Vectorize/Queue |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare Account ID，不是密钥本身，可明文 |
| `AI_GATEWAY_BASE_URL` | Variable | AI Gateway 地址，不是密钥，可明文 |
| 其它带默认值的环境变量 | Variable | 可明文 |

**口诀**：名字里有 `KEY` / `TOKEN` 的，走 Secret；其它走 Variable。

---

## 2. 新部署：正确流程

1. Fork `wusaki0723/Aelios`，clone 到本地。
2. 在 Cloudflare Dashboard 创建 Worker（或先空着，`deploy:cloudflare` 会自动建）。
3. **Worker → Settings → Variables and Secrets**，点 `Add`：
   - 类型选 **Secret**（红框警告：不要选成 Variable！），分别加入你需要的密钥：
     - `CLOUDFLARE_API_TOKEN` —— 你的 Cloudflare API Token
     - `CHATBOX_API_KEY` —— 自己编一个密码，如 `sk-my-aelios-key`
     - 其它 `*_API_KEY` / `CF_AIG_TOKEN` 按你选的用法加
   - 类型选 Variable 加上 `CLOUDFLARE_ACCOUNT_ID`（这个不是密钥）。
4. 回到本地仓库跑：
   ```bash
   npm install
   npm run deploy:cloudflare
   ```
   setup 脚本会读 Dashboard 上的变量、建好 D1 / Vectorize / Queue，但**不会再把你的密钥写进 wrangler.toml**（这是 #9 修好以后的版本）。
5. 部署完拿到 Worker 地址，去客户端填 base_url 和 API Key 就行。

---

## 3. 老 fork 迁移：你已经部署过怎么办

如果你的 fork 是在 #9 merge 之前部署的（2026 年 6 月底之前），并跑过 `npm run deploy:cloudflare`，**有可能你的 git 历史里有过含密钥的 `wrangler.toml`**。即使你本地清理了，已经 push 到 GitHub 的 commit 也清不掉——需要按下面顺序走一遍。

### 第 0 步：先升级 Aelios 到修过的版本

```bash
git remote add upstream https://github.com/wusaki0723/Aelios
git fetch upstream
git checkout main
git merge upstream/main       # 或 git rebase upstream/main
# 如果合并冲突在 wrangler.toml，先把密钥行删掉再解决
```

确认 `scripts/setup-cloudflare.mjs` 里的 `visibleVarNames` 已经不含那 5 个密钥（看不到 `CHATBOX_API_KEY` 等就对了）。

### 第 1 步：检查 wrangler.toml 历史里有没有密钥

在仓库根跑：

```bash
git log -p --all -- wrangler.toml | grep -nE "CHATBOX_API_KEY|MEMORY_MCP_API_KEY|GUIDE_DOG_API_KEY|CF_AIG_TOKEN|CLOUDFLARE_API_TOKEN|IM_API_KEY|DEBUG_API_KEY" | grep "="
```

- **如果 grep 没有任何匹配**：你的 git 历史是干净的，恭喜，直接跳到第 3 步。
- **如果出现形如 `CHATBOX_API_KEY = "sk-xxxxx"` 的行（带真实值）**：你的密钥已经进了 git 历史，必须当作已泄漏处理。继续第 2 步。

### 第 2 步：如果历史里有真值密钥（可跳到 3）

> 关键：**先撤销/rotate，再清理 git 历史**。顺序反了的话，你刚清完 git 又用着同一个密钥，等于没修。

1. 去 Cloudflare Dashboard 撤销当前 API Token，生成新的。
2. 把所有自编的 `CHATBOX_API_KEY` 等也换成新的。
3. 按「新部署」第 3 步，在 Worker 的 Secrets 里加新的密钥（旧的可以删掉）。
4. 清理 git 历史里的旧值——有两种选择：
   - **省心版**：用 BFG Repo-Cleaner。下载 `bfg.jar`，然后：
     ```bash
     git clone --mirror <你的 fork>.git fork-mirror.git
     echo "CHATBOX_API_KEY=" > secrets-to-clean.txt
     echo "MEMORY_MCP_API_KEY=" >> secrets-to-clean.txt
     # 列出所有曾经真值出现过的密钥名
     java -jar bfg.jar --replace-text secrets-to-clean.txt fork-mirror.git
     cd fork-mirror.git
     git reflog expire --expire=now --all && git gc --prune=now --aggressive
     git push
     ```
   - **手撸版**：用 `git filter-repo`（推荐用 BFG，filter-repo 对新手更绕）。
5. 强推到 GitHub：`git push --force`。**force push 会让别人的 fork 和 PR 错位**——但这是清理密钥必须做的，没有第二条路。
6. 让 GitHub 重新 cache：删掉仓库的 PR cache 不需要做，但如果你担心可以联系 GitHub Support 删除 cached views。

> ⚠️ **重点**：就算 git 历史清完了，只要密钥记到 GitHub 公开仓库里一次，就要当作"全网已经爬过"——**必须 rotate，不要存侥幸**。

### 第 3 步：把当前 wrangler.toml 里的密钥行删掉

不管 git 历史有没有泄漏，**当前工作树里 wrangler.toml 的 `[vars]` 段如果有 `CHATBOX_API_KEY = "..."` 之类的行，都删掉**。这些都是不该有的。

```bash
# 打开 wrangler.toml,在 [vars] 段里把下面这些行删掉(留下其它非密钥变量):
# CHATBOX_API_KEY = "..."
# MEMORY_MCP_API_KEY = "..."
# GUIDE_DOG_API_KEY = "..."
# IM_API_KEY = "..."
# DEBUG_API_KEY = "..."
# CF_AIG_TOKEN = "..."
# CLOUDFLARE_API_TOKEN = "..."
```

### 第 4 步：把密钥配进 Cloudflare Worker 的 Secrets

```bash
# 在仓库根目录逐个跑(会交互式让你粘贴值):
npx wrangler secret put CHATBOX_API_KEY
npx wrangler secret put MEMORY_MCP_API_KEY      # 可选
npx wrangler secret put GUIDE_DOG_API_KEY       # 可选
npx wrangler secret put CF_AIG_TOKEN            # 接 AI Gateway 才需要
npx wrangler secret put CLOUDFLARE_API_TOKEN    # 部署脚本要用
```

每个会问你 `Enter a secret value:`，粘贴密钥回车就行。这些值**不会**进 wrangler.toml，只在 Cloudflare 端。

### 第 5 步：把清理后的 wrangler.toml commit 掉

```bash
git add wrangler.toml
git commit -m "chore: 把密钥从 wrangler.toml 移到 Cloudflare Secrets"
git push
```

### 第 6 步：重新部署验证

```bash
npm run deploy:cloudflare
```

部署后随便发个请求测一下 Worker 还正常（比如 `/health`）。能通就说明：运行时 `env.CHATBOX_API_KEY` 等都正确从 Cloudflare Secrets 拿到了——和之前行为一致，只是源头不再泄漏。

---

## 4. 这一切本来怎么发生的（给想了解的姐妹）

`scripts/setup-cloudflare.mjs` 的 `visibleVarNames` 数组里一度混入了 5 个不该混进去的密钥名字。CI 跑 `deploy:cloudflare` 时，setup 脚本会把它们从 `process.env` 读出来写进 git-tracked 的 `wrangler.toml` 的 `[vars]` 段。下次 commit 就把明文密钥 push 上去了。

issue #7 把这事报告出来；PR #9 把这 5 个密钥从 `visibleVarNames` 里删掉，setup 脚本以后再也不碰它们。但**已经部署过的姐妹 git 历史可能依然有密钥**——这份文档就是写给你们的清理指南。

---

## 5. 一句话总结

- 名字带 `KEY` / `TOKEN` 的 → Cloudflare **Secret**（不进 git）
- 名字是 `_URL` / `_ID` / 普通配置的 → Cloudflare **Variable**（进 `[vars]`）
- 已经泄漏过的 → 先 rotate，再清 git 历史
- 没 leak 过 → 直接删 wrangler.toml 的密钥行 + `wrangler secret put` 重配就行