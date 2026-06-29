# Claude Code Hook

This integration connects Claude Code to an Aelios memory Worker.

It does two things:

- `UserPromptSubmit`: searches long-term memory and injects relevant context.
- `UserPromptSubmit` + `Stop`: buffers user and assistant messages, then ingests them into Aelios in small batches.

The hook is a single Python file and uses only the Python standard library.

## Install

Copy the hook into your Claude Code project:

```bash
mkdir -p .claude/hooks
cp integrations/claude-code/companion_memory_hook.py .claude/hooks/
chmod +x .claude/hooks/companion_memory_hook.py
```

Add the hooks from [`settings.example.json`](./settings.example.json) to your project's `.claude/settings.json`.

## Configure

Set these environment variables before starting Claude Code:

```bash
export COMPANION_MEMORY_BASE_URL="https://your-aelios-worker.example.com"
export COMPANION_MEMORY_API_KEY="sk-your-aelios-api-key"
export COMPANION_MEMORY_NAMESPACE="default"
```

`COMPANION_MEMORY_API_KEY` is the Aelios Worker API key, usually the same value as `CHATBOX_API_KEY`.
It is only used to call your Aelios REST API. This hook does not need any model-provider or LLM API keys.

Optional project scoping:

```bash
export COMPANION_MEMORY_PROJECT_ROOT="$PWD"
```

When `COMPANION_MEMORY_PROJECT_ROOT` is set, the hook only runs for Claude Code sessions whose `cwd` is inside that directory. When it is unset, the hook runs for every project where it is installed.

## Common Options

| Variable | Default | Purpose |
|---|---:|---|
| `COMPANION_MEMORY_SEARCH_TOP_K` | `50` | Number of memory candidates requested before server-side filtering. |
| `COMPANION_MEMORY_SEARCH_MAX_TOTAL_CHARS` | `6500` | Maximum injected memory context size. |
| `COMPANION_MEMORY_BATCH_SIZE` | `12` | Flush buffered messages after this many messages. |
| `COMPANION_MEMORY_MAX_AGE_SECONDS` | `900` | Flush buffered messages after this many seconds. |
| `COMPANION_MEMORY_STATE_DIR` | `$XDG_STATE_HOME/aelios-claude-code` or `~/.local/state/aelios-claude-code` | Local buffer, lock, dedupe state, and audit log directory. |
| `COMPANION_MEMORY_AUDIT_LOG` | `<state-dir>/audit.jsonl` | Search audit log path. |

## Commands

The hook can also be run manually:

```bash
python3 .claude/hooks/companion_memory_hook.py status
python3 .claude/hooks/companion_memory_hook.py flush
python3 .claude/hooks/companion_memory_hook.py clear
```

`clear` only removes the local buffer/dedupe files. It does not delete memories from Aelios.

## Security Notes

- Do not commit real API keys in `.claude/settings.json`, shell profiles, or examples.
- Prefer environment variables or your process manager's secret store.
- The hook stores a small local buffer before upload. If your project contains sensitive data, keep `COMPANION_MEMORY_STATE_DIR` in a private user directory.
- The injected memory text is returned through Claude Code's `UserPromptSubmit` hook as additional context. Keep Aelios protected with a strong API key.
