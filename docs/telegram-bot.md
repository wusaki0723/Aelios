# Telegram bot layer

A Telegram front-end for the companion chat pipeline. Messages arrive on a
webhook, get buffered and debounced through the existing Cloudflare Queue, run
through `/v1/chat/completions` in-process (memory recall + ingest included),
and the reply is sent back as separate bubbles split on blank lines.

```
Telegram → POST /tg/webhook          (secret header check, allowlist, 200 fast)
         → tg_inbox (D1)             (buffer)
         → queue tg_process +3s      (debounce window)
         → claim whole buffer        (atomic; rapid messages merge into one turn)
         → /v1/chat/completions      (in-worker call, full memory loop)
         → sendMessage per bubble    (blank line = bubble boundary, 4096 fallback split)
```

Per-chat rolling context lives in `tg_chat_state`: the last N messages verbatim
plus a rolling summary. When the verbatim window overflows, the oldest half is
folded into the summary with a bare LLM call (outside the memory pipeline).

## Setup

1. **Create the bot**: talk to [@BotFather](https://t.me/BotFather), `/newbot`,
   copy the token.

2. **Apply the migration** (adds `tg_inbox` + `tg_chat_state`):

   ```sh
   npx wrangler d1 migrations apply <your-d1-name> --remote
   ```

3. **Set secrets** (Dashboard → Workers → Settings → Variables, or CLI):

   ```sh
   npx wrangler secret put TG_BOT_TOKEN        # from BotFather
   npx wrangler secret put TG_WEBHOOK_SECRET   # any long random string you generate
   npx wrangler secret put TG_SYSTEM_PROMPT    # your persona / system prompt
   npx wrangler secret put IM_API_KEY          # internal key the bot uses to call the chat pipeline
   ```

   - `TG_SYSTEM_PROMPT` is an env var **by design**: forks of this repo are
     public, so personas must never live in a committed file. Single values cap
     at ~5KB; if your persona is longer, put the overflow in
     `TG_SYSTEM_PROMPT_EXTRA` (it is concatenated after the main prompt).
   - `IM_API_KEY` is one of the pipeline's existing key slots (`im` profile).
     If you already use it for another IM integration, the bot shares it.

4. **Register the webhook** (fill in your values):

   ```sh
   curl "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook" \
     -d "url=https://<your-worker-domain>/tg/webhook" \
     -d "secret_token=<TG_WEBHOOK_SECRET>"
   ```

5. **Allowlist yourself**: message the bot once — the webhook drops unknown
   chats silently but logs the chat id. Copy it from the worker logs
   (`npx wrangler tail`, look for `tg: message from non-allowlisted chat`) into
   the `TG_ALLOWED_CHAT_IDS` variable, e.g. `123456789`. Multiple ids are
   comma-separated; `"*"` allows everyone (don't, unless you mean it).

Send another message. The bot should type, then reply.

## Tuning

| Variable | Default | Meaning |
| --- | --- | --- |
| `TG_DEBOUNCE_SECONDS` | `3` | Window merging rapid consecutive messages into one turn |
| `TG_FOLD_TRIGGER_TURNS` | `50` | Fold when `recent` reaches this many turns; everything except the keep window goes into the rolling summary |
| `TG_RECENT_KEEP_TURNS` | `10` | Verbatim turns kept after a fold (the rest are evicted into the summary) |
| `TG_RECENT_MAX_TURNS` | — | Deprecated alias for `TG_FOLD_TRIGGER_TURNS`; used only when the new var is unset (emits a console warning) |
| `TG_SUMMARY_MODEL` | `DREAM_MODEL` → `CHAT_MODEL` | Model used for summary folding |

## Behavior notes

- **Bubbles**: the system prompt instructs the model to separate independent
  thoughts with a blank line; each blank-line block becomes its own Telegram
  message. Blocks over 4096 chars are hard-split as a fallback.
- **Failure semantics**: if the pipeline call fails, the claimed messages are
  returned to the inbox and the queue retries. If some bubbles were already
  sent before a later bubble fails, the failed bubble is logged and skipped —
  duplicates are preferred over losing a reply entirely.
- **Memory**: because the bot goes through `/v1/chat/completions`, recall
  injection and conversation ingest work exactly as they do for Chatbox — the
  bot and Chatbox share one memory.
- **Cron / rollups**: the twin worker has no cron triggers. Dream, weekly rollup,
  and monthly rollup run only on the main worker (`companion-memory-proxy`). Shared
  D1 means the bot still sees their output (daily/weekly/monthly logs, boot
  impressions ladder, dream candidates).
- **Privacy**: non-allowlisted chats get no reply at all (nothing probeable),
  only a log line.
