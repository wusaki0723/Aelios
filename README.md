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

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wusaki0723/Aelios)

Click the button and sign in to Cloudflare. The only required field is `CHATBOX_API_KEY` — make up a password, e.g. `sk-my-aelios`. Everything else can stay empty.

For the Vectorize index, copy these values: Dimensions `1024`, Metric `cosine`. Build command `npm ci`, deploy command `npm run deploy`.

You'll get an address like:

```text
https://companion-memory-proxy.<your-subdomain>.workers.dev
```

Prefer to control every step? Fork this repo → connect it in Cloudflare Workers → build `npm ci`, deploy `npm run deploy` → add the `CHATBOX_API_KEY` secret in Worker Settings. Don't run a bare `wrangler deploy` — it won't create the databases.

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

## Day-to-day: the admin panel

Open `/admin`. The bottom tabs:

| Tab | What it's for |
|---|---|
| **Today** | What you talked about today |
| **Review queue** | Candidate memories consolidated overnight. Each assistant decides its own first; the week's decisions are listed here with an undo. Turn on the daily clef review in settings and nothing waits for you |
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

**MCP memory for Claude Code / Codex**:

```text
https://<Worker address>/mcp?token=<CHATBOX_API_KEY>
```

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

`memory_search` `memory_list` `memory_get` `memory_delete` `memory_ingest` `memory_boot` `memory_recall` `memory_upsert` `memory_supersede` `memory_archive` `memory_pin` `glossary_set` `diary_get` `memory_export`

### How memory flows

**Writes:** assistants write directly via `memory_upsert`; a nightly cron (`10 20 * * *`) extracts facts from the day's conversations → each candidate is judged remember-or-let-go by its space's own assistant, using the main model it last chatted with (falling back to `JUDGE_MODEL`, which leaves unsure ones for you; an assistant can be switched off main-model judging in its settings to save quota; turning on `CLEF_AUTO_REVIEW` hands every candidate to Cloudflare's clef decision model instead, with nothing left for you), and writes diary / weekly / monthly entries.

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
