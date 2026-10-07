# Aelios

**A long memory for your AI.** Switch windows, switch clients, switch models — the memory follows you.

English | [简体中文](README.zh-CN.md) · QQ group: 1091783659

<!-- 🎬 Promo video: upload the Aelios trailer (the one Muse made) via GitHub's web editor and paste the user-attachments link here. A video at the very top of the README is the single highest-leverage change for star conversion. -->

Aelios is a memory gateway that runs on Cloudflare. Your Chatbox / Claude Code / Codex connects to Aelios first; Aelios forwards the request to the model. Every conversation is kept, and the relevant parts come back automatically next time.

```text
your client  →  Aelios (identify, remember, recall)  →  the model
```

## Quick start — three steps

### 1. Deploy

Fork this repo first, then deploy your fork. That way every later update is one click (see [Updating](#updating-to-the-latest-version)).

1. Click **Fork** at the top of this page.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**, connect GitHub and pick your fork. Keep the project name `companion-memory-proxy`, set the build command to `npm ci` and the deploy command to `npm run deploy`. The deploy command creates the D1 database, the Vectorize index and the queue for you.
3. Once it's deployed, open the Worker's **Settings → Variables and Secrets** and add the secret `CHATBOX_API_KEY`: make up a password, e.g. `sk-my-aelios`. It's the only one you need; the optional ones are in [SECRETS.md](SECRETS.md).

You'll get an address like:

```text
https://companion-memory-proxy.<your-subdomain>.workers.dev
```

Don't run a bare `wrangler deploy` — it won't create the databases.

**Not recommended: the one-click button.** [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wusaki0723/Aelios)

It works, but Cloudflare copies this repo into a new repository in your account instead of forking it. GitHub has no Sync fork for a copy, so every update has to be pulled in by hand. If you use it anyway: the only required field is `CHATBOX_API_KEY`; for the Vectorize index use Dimensions `1024`, Metric `cosine`; build command `npm ci`, deploy command `npm run deploy`. Already deployed this way? See [Deployed with the button](#deployed-with-the-button).

### 2. Add an assistant

Open:

```text
https://<your Worker address>/admin
```

Enter your Worker address and the key from step 1, then go to **Settings**.

1. **Upstream**: your Cloudflare account ID (32 characters). For full chat forwarding, also add a `CLOUDFLARE_API_TOKEN` Worker secret.
2. **Assistant**: click *Add assistant*, for example:

   | Field | What it means | Example |
   |---|---|---|
   | Name | The segment in the URL, lowercase English | `coder` |
   | Primary model | Only these models remember and recall | `anthropic/claude-opus-4-5` |
   | Keys | Who may use this assistant | check the primary key |

3. Click **Save**.

One assistant, one address. Name it `coder` and the address is:

```text
https://<your Worker address>/coder/v1
```

Only registered primary models get memory. Unregistered models (like the small utility models inside Claude Code) just pass through — nothing is recorded or recalled for them.

### 3. Point your client at it

Use `CHATBOX_API_KEY` as the API key everywhere. Write model names as `vendor/model`, e.g. `anthropic/claude-opus-4-5`.

| Client | Address to use |
|---|---|
| Chatbox, Cherry Studio, … | `https://<Worker address>/coder/v1` |
| Claude Code | `ANTHROPIC_BASE_URL=https://<Worker address>/coder` |
| Codex | `base_url = https://<Worker address>/coder/v1`, with `wire_api = "responses"` |

A bare `/v1` without an assistant name routes to the first assistant of that key.

Try it: say *"Please remember: my test code phrase is apple-star-0428."* Wait a bit, then ask *"What is my test code phrase?"* If it answers, you're wired up.

## Updating to the latest version

GitHub doesn't update forks by itself. When a new version is out:

1. Open your fork on GitHub and click **Sync fork → Update branch**.
2. Cloudflare picks up the new commit, builds and deploys it on its own. You can follow it under the Worker's **Deployments**.

Memories, settings, assistants and keys live in your Cloudflare account, not in the repo, so syncing keeps all of them. Change settings in `/admin` rather than by editing files in your fork, and Sync fork stays a one-click update with no conflicts.

Want it automatic? The [Pull](https://github.com/apps/pull) app syncs a fork on a schedule. Every new version then goes live without you looking at it first, database migrations included, and by default Pull hard-resets your fork to this repo, dropping any commits of your own. Syncing by hand is the recommended way.

### Deployed with the button

A button deploy is a copy, not a fork, so it has no Sync fork. Move your Worker onto a fork instead; your memories and settings stay where they are, in Cloudflare.

1. Fork this repo.
2. If you renamed the D1 database or the Vectorize index on the button's setup page, open the Worker's **Settings → Build → Build Variables and Secrets** and add `CMP_D1_NAME` and `CMP_VECTORIZE_NAME` with those names. Otherwise the build creates new, empty ones and your memories look gone (they're still in the old database).
3. In **Settings → Build**, click **Disconnect**, then **Connect** and pick your fork, with build command `npm ci` and deploy command `npm run deploy`.
4. If Cloudflare opens a pull request on your fork to fix the Worker name, merge it.

From then on, Cloudflare builds from your fork whenever it changes, so your next Sync fork brings you up to date. Until then the Worker keeps running the version it has.

## Day-to-day: the admin panel

Open `/admin`. The bottom tabs:

| Tab | What it's for |
|---|---|
| **Today** | What you talked about today |
| **Review queue** | Candidate memories consolidated overnight. Cloudflare's clef reviews them every night by default; the week's decisions are listed here with an undo. With clef switched off they wait here, or the assistant reviews them itself over MCP |
| **Important memories** | Browse, search, edit, delete |
| **More** | Precious originals, glossary, maintenance tools |
| **Settings** | Upstream, assistants, environment parameters |

Want the AI to remember, forget, or fix something? It's all point-and-click.

## How it actually works

- Every time you speak, relevant old memories are tucked onto the end of the current conversation.
- Raw conversations are stored first; overnight, Aelios consolidates them into long-term memory (the *Dream* pass). Each assistant decides what it keeps using the model it chats with, and you can undo any of its calls.
- Memory lives in **your own Cloudflare account** (D1 + Vectorize) — never tied to a chat window, never on someone else's server.

One assistant can write to one space and read from several. A fresh conversation can write `coder` while also reading the old vault `coder-old` and a shared `shared-docs`. Leave the recall spaces empty and it only reads its own.

## Optional features

**Full chat gateway** — let Aelios forward to every vendor's models, billed against your own keys:

1. Cloudflare → AI → AI Gateway: create a gateway and store each vendor's key under it.
2. Add the `CLOUDFLARE_API_TOKEN` Worker secret.
3. In `/admin` Settings, put your 32-character account ID as the upstream and add assistants.

Skip all of that and memory recall + the overnight Dream still work (via Workers AI).

**MCP memory for the Claude app (web and mobile), Claude Code and Codex**:

```text
https://<Worker address>/mcp?token=<CHATBOX_API_KEY>
```

- Claude app: add a custom connector on the connectors page (claude.ai/customize/connectors) with the address above. Once it is added on the web it shows up in the mobile app too. Under tool permissions, set the read-only group to "Always allow", or every recall asks first.
- The Claude app does not read the usage notes an MCP server sends. To make it remember to use the memory, paste this into your personal preferences or project instructions:

```text
You have the Aelios memory connector: it is your long-term memory of me. In every new conversation, call wake_up before you reply. Before answering anything about my past or the people in my life, or before guessing something about me, call recall. When I tell you something new, change my mind or make a promise, call remember right away. When the conversation winds down, call log_conversation.
```

- Conversations in the Claude app do not pass through Aelios, so the nightly diary and candidates only see what the assistant hands over with `log_conversation`. Clients that go through the gateway don't need it.
- Only the nine everyday tools are listed by default. For maintenance tools such as `memory_get` and `memory_export`, add `&tools=all` to the address.

For automatic per-message recall and batch write-back in Claude Code, use the Hook in this repo: [`integrations/claude-code/`](integrations/claude-code/README.md).

**Seeing images (guide-dog)**: add the `GUIDE_DOG_API_KEY` secret, then point your client at `https://<Worker address>/v1/guide-dog` with model `companion`. The guide-dog only describes images — it writes no memory.

## Common pitfalls

- Deploy with `npm run deploy`, never a bare `wrangler deploy`.
- Assistant names are part of the URL: use `coder`-style English, no spaces.
- Model names need the vendor prefix: `anthropic/claude-opus-4-5`, not `claude-opus-4-5`.
- Only registered primary models get memory. Keep small utility models out.
- Never hand-delete the Vectorize index (`memo-kb`, 1024-dim cosine).

## Digging deeper

- How the gateway routes, remembers, and recalls: [docs/memory-gateway.md](docs/memory-gateway.md)
- What happens to requests, how thinking is handled: [docs/request-contract.md](docs/request-contract.md)
- Which secrets are required: [SECRETS.md](SECRETS.md)
- For maintainers: endpoints, MCP tools, and the memory lifecycle — see the sections below.

---

# For maintainers

A memory gateway on Cloudflare Workers. When helping a user deploy, always link **the user's own fork**; all secrets live in the user's own account.

| Resource | Value |
|---|---|
| Worker | `companion-memory-proxy` |
| D1 | `companion_memory_proxy` |
| Vectorize | `memo-kb` (1024-dim, cosine) |
| Queue | `companion-memory` |
| Embedding | `workers-ai/@cf/baai/bge-m3` |

Entry points: `/<assistant>/v1/chat/completions`, `/<assistant>/v1/messages`, `/<assistant>/v1/responses`. A bare `/v1/...` uses the first assistant of that key.

Upstreams: chat goes through compat (all vendors, BYOK); messages / responses hit each vendor's native endpoint. Model names pass through untouched — if the vendor doesn't recognize one, the upstream error says so. Custom OpenAI-compatible base URLs are forwarded as-is.

Configuration has three layers, all under `/admin` Settings: upstream, assistants, environment parameters. Precedence: panel-saved > `GATEWAY_CONFIG` > empty config.

### Common endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/admin` | Admin panel |
| GET | `/v1/models` | Model list |
| POST | `/<assistant>/v1/chat/completions` | OpenAI-compatible chat |
| POST | `/<assistant>/v1/messages` | Anthropic messages |
| POST | `/<assistant>/v1/responses` | OpenAI responses |
| GET / POST | `/mcp` | MCP memory tools |
| GET / POST | `/v1/memories` | List / create memories |
| POST | `/v1/memory/recall` | Dynamic recall (preferred by hooks) |
| POST | `/v1/search/memories` | Raw search (unmetered) |
| POST | `/v1/ingest/messages` | Ingest raw chats |
| GET | `/v1/memory_boot` | Cold-start pack |
| GET | `/v1/diary`, `/v1/diary/recent` | Diary |
| GET / POST / DELETE | `/v1/precious`, `/v1/glossary` | Precious originals / glossary |
| GET / POST | `/v1/candidates` | Review queue; `/decisions?days=7` lists automatic decisions, `/:id/undo` reverses one |

Everything except `/health` and `/admin` requires `Authorization: Bearer <key>`. The gateway authorizes by assistant key; memory APIs by `memory:read` / `memory:write` scopes.

### MCP tools

`wake_up` `recall` `remember` `keep_moment` `forget` `learn_word` `read_diary` `log_conversation` `list_memories`

With the clef review switched off, `memory_candidates` and `memory_review` are listed too; `&tools=all` on the address adds `memory_get` and `memory_export`. The old names (`memory_boot`, `memory_recall`, `memory_search`, `memory_upsert`, `memory_supersede`, `memory_archive`, `memory_delete`, `memory_ingest`, `memory_pin`, `glossary_set`, `diary_get`, `memory_list`) are no longer listed but still work when called.

### How memory flows

**Writes:** assistants write directly via `remember`; a nightly cron (`10 20 * * *`) extracts facts from the day's conversations → each candidate is judged remember-or-let-go by Cloudflare's clef decision model (`CLEF_AUTO_REVIEW`, on by default; switched off, candidates wait for you, or the assistant reviews them itself with the MCP tools `memory_candidates` and `memory_review`), and writes diary / weekly / monthly entries.

**Recall:** your latest message → vector search + lexical match → batch rerank of original passages + rules → the clean original text is tucked onto the end of the current message. No generative LLM by default: at most one memory on a normal turn, two when answering about the past; low scores are never padded in. Rerank failures fall back to lexical. Scores and trade-offs are visible in `/admin → Settings`. Transport envelopes, hashes, and message IDs never enter the daily prompt; two adjacent messages within 90 seconds in one session are merged. Active search still returns full records and IDs. Diaries are not auto-injected.

**Cleanup:** messages live ~7 days; a memory not rewritten, recalled or seen again for 180 days is flagged expired (pinned, identity and persona never are), and expired records are hard-deleted 30 days later.

### Local verification

```bash
npm install
npm run verify
```

Tests need Node.js 22+.

Lint is blocking in CI: `npm run lint` must be zero-error to merge. There are still 17 `noNonNullAssertion` warnings; the rule is demoted to warning in `biome.json` and doesn't affect the exit code — clean them up if you're touching that line, and never bulk-fix with Biome's autofix: it rewrites `x!.y` into `x?.y`, turning "crash loudly" into "silently return undefined".

## License

AGPL-3.0

Free to use and modify; if you run a modified version as a network service, you must open-source your modifications under the same license.

The final v1 point is tag `v1-final` (MIT at the time). `tg-bot` is the Telegram integration branch, stuck at 2026-07-16 as of 2026-09-11 with main 154 commits ahead (135 files, ~18k lines changed) while the branch itself only added 17 files — it can't be merged back as-is. Kept as history; resurrect it by rebasing onto main, never by direct merge.

## Community

QQ group: **1091783659**
