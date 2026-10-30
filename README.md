# Aelios

**A long memory for your AI.** Switch windows, switch clients, switch models — the memory follows you.

English | [简体中文](README.zh-CN.md) · QQ group: 1091783659

<!-- 🎬 Promo video: upload the Aelios trailer (the one Muse made) via GitHub's web editor and paste the user-attachments link here. A video at the very top of the README is the single highest-leverage change for star conversion. -->

Aelios is a memory gateway that runs on Cloudflare. Your Chatbox / Claude Code / Codex connects to Aelios first; Aelios forwards the request to the model. Every conversation is kept, and the relevant parts come back automatically next time.

```text
your client  →  Aelios (identify, remember, recall)  →  the model
```

## Let an AI set it up

With an AI that can run commands (Claude Code, Codex and the like), send it this:

```text
Install and set up Aelios (my AI memory gateway) for me. Read https://raw.githubusercontent.com/wusaki0723/Aelios/main/docs/setup-with-ai.md first and follow it. When I need to click something in the browser or enter a key myself, stop and tell me where.
```

It works from scratch: it forks and deploys Aelios, creates the Cloudflare token, configures the assistant and imports your old memories. At the end it hands you a base URL, an API key and the model name to pick, ready for your chat app. You need a Cloudflare account (the free plan is enough) and a key for your model. All you do yourself is click "Allow" in the browser (twice for a new install) and store the model key in the Cloudflare dashboard (it tells you where). The guide is written in Chinese; the AI will talk to you in your language.

The recommended setup is **API mode plus the MCP connector**: chats go through Aelios, so every turn is remembered and recalled automatically, and with MCP the assistant can also look things up and save them on its own. Only if you have a Claude subscription and no API access, use MCP alone.

To do it by hand, follow the three steps below.

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

When you code with tools such as Claude Code, Codex or Cline, Aelios keeps only what was said: code blocks are saved as `[code]`, and steps that read, run or edit code are not saved. To save everything, open the assistant's "Recall spaces, thinking blocks, size limit, coding filter" and turn off "When coding, keep only what was said".

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

Open `/admin`. The pages are in the menu on the left (on a phone, tap ☰ at the top left). The bottom of the menu switches between 中文 and English and between light and dark; with no choice saved, the page follows your browser's language.

| Page | What it's for |
|---|---|
| **Home** | Today's chats (♥ keeps a line as a keepsake; the bin deletes one you don't want kept, such as an error, garbled text or a flat refusal, so the nightly run, the journal and recall never read it), anything waiting for you, last night's run and the latest journal entry |
| **Review** | Candidate memories from the nightly run. Cloudflare's clef reviews them every night by default; "Auto-handled this week" lists those decisions with an undo. With clef switched off they wait under "Daily" (you can tick several and remember or discard them together), or the assistant reviews them itself over MCP. Anything imported from elsewhere sits under "Imported" and waits for you alone |
| **Journal** | One entry a day, plus weekly summaries. If one came out empty, open it and press **Rewrite from the originals** |
| **Memories** | Core memories: browse, search, edit, merge, remove; a memory rewritten in place keeps its earlier versions under History, where you can restore one. Also Keepsakes, Our words (glossary), Notebook and World facts |
| **Star map** | Your memories drawn as a 3D star map (a separate page) |
| **Nightly** | What the nightly consolidation (Dream) did each night and what it produced; you can also re-run a night by hand, see below |
| **Import & export** | Export a backup; import a list or a chat history |
| **Settings** | Essentials, assistants, upstream and model list, every parameter, connection and keys, and troubleshooting (the recall log and maintenance tools) |

Want the AI to remember, forget, or fix something? It's all point-and-click.

### Re-running Dream for one day

When a night's consolidation failed, or you want a day processed now:

1. Open **Nightly** and check the space shown under **Viewing** at the top left.
2. Under **Run a night by hand**, pick the night and **untick "Preview only, don't save"** (ticked by default; ticked only previews and writes nothing). Usually leave "Redo if already processed" off. A failed night in **Last 7 nights** has a **Re-run this night** button that fills this in for you.
3. Press **Start**. Once it says it is queued you can close the page; the job runs in the background, and a refresh shows the result.
4. Each press handles one batch (`DREAM_MAX_MESSAGES` messages, 40 by default). For a busy day press again until it says the night was already processed. When the day's last batch finishes, that day's journal entry is written automatically.

- Button greyed out and the run marked as possibly stopped: check the Worker logs that it really stopped, press **Checked — mark as stopped**, then press again.
- A journal entry that only says what was tidied up: that is Dream's draft. Open it in the Journal and press **Rewrite from the originals**. Chat is kept for 7 days; after that it can't be rewritten.
- The detailed execution rules, API and limits are under [For maintainers → Dream execution and failure status](#dream-execution-and-failure-status).

### Moving memories: export and import

On the **Import & export** page, each one works on the space you have selected:

- **Export**: md or jsonl. The md has one memory per line (date, text, #tags, the key in backticks); open it, edit it, and import it back as is. A line with the same key rewrites that memory, and the old version is kept.
- **Import tidied entries**: one per line, `- 2025-12-15 [preference] text #tag`; date, type and tags are optional, and a plain md list or paragraphs work too. The page has a ready prompt to paste into the AI you used before so it lists what it remembers in this format. Entries can go straight in (exact duplicates are skipped, near-duplicates go to review) or all go to review first.
- **Import a chat history**: ChatGPT and Claude `conversations.json`, SillyTavern `.jsonl`, and plain "Name: text" transcripts. The file is read in the page and cut by day; each day goes through the same model the nightly consolidation uses (`DREAM_MODEL`), and what it finds only lands in the review page's "Imported" tab, where nothing counts until you approve it. Progress and token use are shown as it runs. Only the lines a candidate quotes are kept, outside the chat table, so the 7-day cleanup never removes them and the nightly run never re-reads them. Close the page and pick the same file later to carry on.

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

Skip all of that and memory recall + the overnight Dream still work (via Workers AI). An AI can do these three steps for you: see [Let an AI set it up](#let-an-ai-set-it-up).

**Choose which models your app lists** — AI Gateway has thousands of models, and a chat app that only lets you pick from the list gets all of them. In `/admin` Settings → **Models & upstream** → Model list → **Edit**, pick the ones you use from the upstream catalog (the `+` button) and type in any name the catalog does not have (custom providers, dynamic routes, suffixes such as `:floor`). The link button beside a listed model sends it one tiny real request, the way a chat client would, and turns into a green dot when it answers; the `−` button takes it off the list. `GET /v1/models` then answers with exactly that list, in the order you added the models. It only changes what is shown: a model that is not on the list can still be called by name, as before. Leave it empty and nothing changes (the whole catalog is shown). With a list saved, the `chatgpt/…` models are shown only if you picked them; the picker lists them first.

**Use your ChatGPT plan** — on a ChatGPT Plus or Pro plan, let your assistant run on the plan instead of an API key (OpenAI's "Sign in with ChatGPT"):

1. `/admin` → Settings → **Models & upstream** → ChatGPT plan → **Manage** → *Continue with ChatGPT*. Sign in and approve.
2. Your browser then lands on a `127.0.0.1` page that fails to load. That is expected: copy the whole address from the address bar, paste it into the box in `/admin` and press *Finish sign-in*.
3. Use models named `chatgpt/<model>`. The *Test* button lists what your account can use. To give one memory, add `chatgpt/*` to the assistant's primary models.

Good to know: it connects your own account and nothing else, so don't hand this route to other people. Usage counts against your plan's limits (ChatGPT settings → Usage). Clients speaking chat/completions, Anthropic messages or responses all work (the first two are translated to Responses and back, thinking blocks included), and OpenAI's plan route rejects hosted tools such as image generation, file search, code interpreter and MCP; function tools and web search work. No new secret is needed: the tokens sit encrypted in D1 under a key derived from `CHATBOX_API_KEY`, so changing that key means signing in again. `npm run deploy` applies the new migration. The overnight jobs can use the plan too: put `chatgpt/<model>` in Settings → Dream model (and the diary model if you like). They send several requests a night, all counted against the plan; on a night the plan is out, those jobs fail like any other model error and the memory stays put.

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
- Only the ten everyday tools are listed by default. For maintenance tools such as `memory_get` and `memory_export`, add `&tools=all` to the address.

If you only have a Claude subscription and cannot use API mode, get automatic per-message recall and batch write-back in Claude Code with the Hook in this repo: [`integrations/claude-code/`](integrations/claude-code/README.md).

**Seeing images (guide-dog)**: add the `GUIDE_DOG_API_KEY` secret, then point your client at `https://<Worker address>/v1/guide-dog` with model `companion`. The guide-dog only describes images — it writes no memory.

**A companion that lives on Cloudflare: [Aelios-resident](https://github.com/wusaki0723/Aelios-resident)** — a separate Worker (one Durable Object, built on Cloudflare's Think) that you talk to on Telegram and on its own web page, both one conversation. With Aelios connected, its chat goes through your assistant's `/v1` endpoint like any other client, so Aelios does the recalling and the remembering; it also uses the memory tools, and what lasts from its web searches is saved as world knowledge. On top of that it writes itself a handoff letter when you go quiet, checks in on a schedule, searches and reads the web, connects other MCP servers, and lets you change the model, persona and settings on its web page. It runs on the Workers Free plan. To connect it, fill in this Aelios's address, a key and the assistant to chat as on its settings page (the model you pick has to be one of that assistant's primary models); deployment is in its README.

## Common pitfalls

- Deploy with `npm run deploy`, never a bare `wrangler deploy`.
- Assistant names are part of the URL: use `coder`-style English, no spaces.
- Model names need the vendor prefix: `anthropic/claude-opus-4-5`, not `claude-opus-4-5`.
- Only registered primary models get memory. Keep small utility models out.
- Never hand-delete the Vectorize index (`memo-kb`, 1024-dim cosine).
- **Run a night by hand** on the Nightly page has "Preview only" ticked by default, which writes nothing; untick it for a real run.

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
| GET | `/v1/models` | Model list (the upstream catalog, or your saved model list) |
| POST | `/<assistant>/v1/chat/completions` | OpenAI-compatible chat |
| POST | `/<assistant>/v1/messages` | Anthropic messages |
| POST | `/<assistant>/v1/responses` | OpenAI responses |
| GET | `/api/gateway/models` | Model picker for `/admin` (owner key): every upstream model id, your ChatGPT models, the saved list |
| POST | `/api/gateway/models/test` | Connectivity test for one model (owner key): `{"model": "…"}` → one tiny chat request, `{ok, status, latency_ms, error?}`; nothing is recorded |
| GET / POST | `/api/gateway/chatgpt/*` | ChatGPT plan sign-in (owner key): `status`, `login`, `callback`, `test`, `welcome`, `logout` |
| GET / POST | `/mcp` | MCP memory tools |
| GET / POST | `/v1/memories` | List / create memories |
| POST | `/v1/memory/recall` | Dynamic recall (preferred by hooks) |
| POST | `/v1/search/memories` | Raw search (unmetered) |
| POST | `/v1/ingest/messages` | Ingest raw chats |
| GET | `/v1/memory_boot` | Cold-start pack |
| GET | `/v1/diary`, `/v1/diary/recent` | Diary |
| POST | `/admin/diary-rewrite` | Rewrite one diary entry from that day's chat: `{"date":"YYYY-MM-DD"}` |
| GET | `/v1/dream/status` | Dream runs from the last 7 days, the active task, cursors |
| POST | `/v1/dream/run` | Run Dream by hand: `date`, `force`, `dry_run`; add `"background":true` to queue it (202 with a `run_id`) |
| POST | `/v1/dream/resolve` | Mark a task unconfirmed for over 20 minutes as interrupted: `{"run_id":"…"}` |
| GET / POST / DELETE | `/v1/precious`, `/v1/glossary` | Precious originals / glossary |
| GET / POST / PATCH / DELETE | `/v1/notebook` | Notebook pages; `/:id` opens, edits or deletes one, `DELETE ?confirm=all` clears the space's notebook |
| GET / POST | `/v1/candidates` | Review queue; `?scope=daily` for the nightly ones only, `/decisions?days=7` lists automatic decisions, `/:id/undo` reverses one, `/:id/sources` shows the quoted lines |
| GET | `/v1/memories/export?format=md\|jsonl` | Export the space's memories and precious lines (`memory:read` is enough) |
| GET | `/v1/memories/:id/revisions` | Earlier versions of a memory rewritten in place |
| GET / POST | `/v1/import/*` | Import: `info`, `entries/preview`, `entries`, `batches`, `chat/chunk`, `candidates` |

Everything except `/health` and `/admin` requires `Authorization: Bearer <key>`. The gateway authorizes by assistant key; memory APIs by `memory:read` / `memory:write` scopes.

### MCP tools

`wake_up` `recall` `remember` `keep_moment` `forget` `learn_word` `read_diary` `log_conversation` `list_memories` `notebook`

`notebook` keeps named pages the assistants read and rewrite themselves, such as progress on a long task. Pages are never recalled automatically, changed overnight or expired; you can edit, delete or clear them under Memories → Notebook.

With the clef review switched off, `memory_candidates` and `memory_review` are listed too; `&tools=all` on the address adds `memory_get` and `memory_export`. The old names (`memory_boot`, `memory_recall`, `memory_search`, `memory_upsert`, `memory_supersede`, `memory_archive`, `memory_delete`, `memory_ingest`, `memory_pin`, `glossary_set`, `diary_get`, `memory_list`) are no longer listed but still work when called.

### How memory flows

**Writes:** assistants write directly via `remember`; a nightly cron (`10 20 * * *`) extracts facts from the day's conversations → each candidate is judged remember-or-let-go by Cloudflare's clef decision model (`CLEF_AUTO_REVIEW`, on by default; switched off, candidates wait for you, or the assistant reviews them itself with the MCP tools `memory_candidates` and `memory_review`), and writes diary / weekly / monthly entries. It consolidates "yesterday" in `DREAM_TIME_ZONE`, in batches of `DREAM_MAX_MESSAGES`, at most `DREAM_MAX_RUNS` batches a night; a day left unfinished gets one more batch on each of the next few nights (3-day lookback), or you can finish it by hand on the Nightly page. A day's diary is written once its last batch is done.

**Recall:** your latest message → vector search + lexical match → batch rerank of original passages + rules → the clean original text is tucked onto the end of the current message. No generative LLM by default: at most one memory on a normal turn, two when answering about the past; low scores are never padded in. Rerank failures fall back to lexical. Scores and trade-offs are visible in `/admin` → Settings → Troubleshooting. Transport envelopes, hashes, and message IDs never enter the daily prompt; two adjacent messages within 90 seconds in one session are merged. Active search still returns full records and IDs. Diaries are not auto-injected.

**Cleanup:** messages live ~7 days; a memory not rewritten, recalled or seen again for 180 days is flagged expired (pinned, identity and persona never are), and expired records are hard-deleted 30 days later.

### Dream execution and failure status

The admin Nightly page submits non-dry manual Dream runs to the existing durable `MEMORY_QUEUE`. Acceptance returns a run ID immediately; after acceptance, closing the browser does not cancel the queued work. The panel polls status every five seconds and can find the task again after a reload. Queue batches contain one message so several expensive Dream jobs do not share one invocation's execution budget.

API clients opt in with `POST /v1/dream/run` and `{"background":true}` (plus the usual optional namespace, date and force). A successful enqueue returns HTTP **202** with `data.run_id` and `data.status="queued"`; use `GET /v1/dream/status` to follow it. As with the legacy endpoint, each manual job handles one batch, not necessarily the whole date; use the cursor to check whether more batches remain. Missing queues and failed acceptance return **503**. Without `background:true`, the old synchronous contract remains; dry-runs also stay synchronous.

- A queued/running task blocks another background admission in the same space; `force` does not bypass it. This is not a global lease covering cron and legacy synchronous callers.
- A single digest/extraction call has a 120-second deadline, including its response body. The two-stage extraction phase has an eight-minute budget and at most three batch reductions. Invalid JSON/schema causes both stages to restart on the same smaller prefix; the suffix remains for a later batch. Empty valid candidates differ from malformed output. A single unusable entry inside an otherwise valid answer (blank, over-long or wrong-typed) is dropped and counted in the logs instead of failing the batch; a wrong container type, a missing candidate list, or a non-empty list in which nothing is usable still counts as malformed. The extraction call has the same output budget as the digest (`DREAM_MAX_TOKENS`, up to 8000). Model/format failure does not advance the cursor or actively delete that batch's raw messages; the separate retention policy still applies.
- Records older than 20 minutes without confirmed completion are labelled **possibly interrupted / unconfirmed**, not endlessly presented as healthy work. This is a read-only hint, not proof that execution stopped. Old unresolved records require log inspection and explicit operator reconciliation; they are not silently cleared to permit another run. Once you have checked the logs, the panel's **Mark as interrupted** button (or `POST /v1/dream/resolve` with `{"run_id":"…"}`, same `memory:write` scope) closes a queued/running record older than 20 minutes; anything newer or already finished is refused. The record then shows as an error and stops blocking a new task. Whatever it had already written is not rolled back.
- Each Dream batch leaves a housekeeping draft on that date's diary entry; the real diary replaces it once the date's last batch is done. The nightly cron only writes yesterday's diary, so a manual job, the manual backfill endpoint and the cron backfill now write the diary themselves after a date's last batch (nothing happens until that batch is done, and a diary failure does not undo the Dream). On the Journal page, **Rewrite from the originals** (`POST /admin/diary-rewrite` with `{"date":"YYYY-MM-DD"}`) redoes any day whose chat is still within retention and replaces its current text; it is refused once that week has been rolled up into a weekly entry.
- A conditional claim prevents duplicate delivery of one job from re-executing its pipeline. This is **not exactly-once completion or automatic crash recovery**: after a claim, ambiguous or partial writes are not automatically replayed. Inspect the run before retrying. The manual follow-up candidate review is retained; its failure does not undo an already completed Dream.

### Local verification

```bash
npm install
npm run verify
```

Tests need Node.js 22+.

Lint is blocking in CI: `npm run lint` must be zero-error to merge. There are still some `noNonNullAssertion` warnings; the rule is demoted to warning in `biome.json` and doesn't affect the exit code — clean them up if you're touching that line, and never bulk-fix with Biome's autofix: it rewrites `x!.y` into `x?.y`, turning "crash loudly" into "silently return undefined".

## License

AGPL-3.0

Free to use and modify; if you run a modified version as a network service, you must open-source your modifications under the same license.

The final v1 point is tag `v1-final` (MIT at the time).

## Community

QQ group: **1091783659**
