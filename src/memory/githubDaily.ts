import { getOrCreateConversation } from "../db/conversations";
import { saveIngestMessages } from "../db/messages";
import { readCursor, writeCursor } from "../db/retention";
import { enqueueMemoryMaintenanceIfNeeded } from "../queue/producer";
import type { Env, OpenAIChatMessage } from "../types";

// Client pushes daily archives in UTC+8 (Singapore/China). Hardcoded offset
// so Worker cron (04:10 SGT) targets the correct calendar dates.
const CLIENT_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

const MAX_ENTRY_CHARS = 2000;
const GITHUB_USER_AGENT = "aelios-daily-pull";
const INGEST_SOURCE = "github-daily";

// saveIngestMessages does not hash/dedup by content (unlike saveUserMessages).
// Re-pulling "today" on every cron would duplicate rows, so only yesterday is ingested.
const INGEST_TODAY_WITHOUT_DEDUP = false;

export interface ParsedDailyEntry {
  kind: "turn" | "summary";
  time?: string;
  user?: string;
  assistant?: string;
  content?: string;
}

export interface GithubDailyPullResult {
  repo?: string;
  dates?: string[];
  fetched?: number;
  parsed?: number;
  ingested?: number;
  skipped?: string;
  errors?: string[];
}

function truncate(text: string, max = MAX_ENTRY_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function resolveGithubDailyNamespace(env: Env): string {
  const configured = env.GITHUB_DAILY_NAMESPACE?.trim();
  if (configured) return configured;
  return env.DREAM_NAMESPACE?.trim() || "default";
}

function formatDateInClientTz(date: Date): string {
  const shifted = new Date(date.getTime() + CLIENT_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function getClientTzDates(now = new Date()): { yesterday: string; today: string } {
  const today = formatDateInClientTz(now);
  const yesterday = formatDateInClientTz(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return { yesterday, today };
}

function cursorKey(repo: string, date: string): string {
  return `github_daily:${repo}:${date}`;
}

function extractSection(block: string, heading: string): string | null {
  const pattern = new RegExp(
    `###\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|\\n##\\s+|$)`,
    "i"
  );
  const match = block.match(pattern);
  if (!match) return null;
  const text = match[1].trim();
  return text || null;
}

function parseTurnLine(line: string): ParsedDailyEntry | null {
  const match = line.match(/^- (\d{2}:\d{2}) \[turn\] u: (.+?) ⇢ a: (.+)$/);
  if (!match) return null;
  return {
    kind: "turn",
    time: match[1],
    user: match[2].trim(),
    assistant: match[3].trim()
  };
}

function parseCheckpointBlock(block: string): ParsedDailyEntry | null {
  if (!/###\s+writer\s+摘要/i.test(block)) return null;

  try {
    const writer = extractSection(block, "writer 摘要");
    if (!writer) return null;

    const unfinished = extractSection(block, "未收尾");
    const parts = [writer];
    if (unfinished) {
      parts.push(`未收尾:\n${unfinished}`);
    }

    return {
      kind: "summary",
      content: parts.join("\n\n")
    };
  } catch {
    return null;
  }
}

export function parseDailyMarkdown(md: string): ParsedDailyEntry[] {
  const entries: ParsedDailyEntry[] = [];

  for (const rawLine of md.split("\n")) {
    const line = rawLine.trimEnd();
    try {
      const turn = parseTurnLine(line.trim());
      if (turn) entries.push(turn);
    } catch {
      // skip broken turn line
    }
  }

  const checkpointPattern = /^## checkpoint[^\n]*$/gm;
  const starts: number[] = [];
  let startMatch: RegExpExecArray | null;
  while ((startMatch = checkpointPattern.exec(md)) !== null) {
    starts.push(startMatch.index);
  }

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : md.length;
    const block = md.slice(start, end);

    try {
      const summary = parseCheckpointBlock(block);
      if (summary) entries.push(summary);
    } catch {
      // skip broken checkpoint block
    }
  }

  return entries;
}

function entriesToMessages(entries: ParsedDailyEntry[]): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];

  for (const entry of entries) {
    if (entry.kind === "turn" && entry.user && entry.assistant) {
      messages.push({ role: "user", content: truncate(entry.user) });
      messages.push({ role: "assistant", content: truncate(entry.assistant) });
      continue;
    }

    if (entry.kind === "summary" && entry.content) {
      messages.push({ role: "user", content: truncate(entry.content) });
    }
  }

  return messages;
}

async function ingestParsedEntries(
  env: Env,
  input: {
    namespace: string;
    date: string;
    entries: ParsedDailyEntry[];
  }
): Promise<number> {
  const messages = entriesToMessages(input.entries);
  if (messages.length === 0) return 0;

  const conversation = await getOrCreateConversation(env.DB, {
    namespace: input.namespace,
    id: `${input.namespace}:github-daily:${input.date}`
  });

  const ids = await saveIngestMessages(env.DB, {
    conversationId: conversation.id,
    namespace: input.namespace,
    source: INGEST_SOURCE,
    messages
  });

  if (ids.length > 0) {
    await enqueueMemoryMaintenanceIfNeeded(env, {
      namespace: input.namespace,
      conversationId: conversation.id,
      fromMessageId: ids[0],
      toMessageId: ids[ids.length - 1],
      source: INGEST_SOURCE
    });
  }

  return ids.length;
}

async function fetchDailyMarkdown(
  env: Env,
  input: { repo: string; path: string; date: string; token: string }
): Promise<{ status: "ok"; markdown: string } | { status: "missing" } | { status: "auth_failed" } | { status: "error"; message: string }> {
  const url = `https://api.github.com/repos/${input.repo}/contents/${input.path}/${input.date}.md`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github.raw+json",
        "User-Agent": GITHUB_USER_AGENT
      },
      signal: controller.signal
    });

    if (response.status === 404) return { status: "missing" };
    if (response.status === 401 || response.status === 403) return { status: "auth_failed" };
    if (!response.ok) {
      return { status: "error", message: `HTTP ${response.status}` };
    }

    const markdown = await response.text();
    return { status: "ok", markdown };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "error", message: "fetch timed out after 30s" };
    }
    return { status: "error", message: String(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runGithubDailyPull(env: Env): Promise<GithubDailyPullResult> {
  try {
    const repo = env.GITHUB_DAILY_REPO?.trim();
    const token = env.GITHUB_DAILY_TOKEN?.trim();
    if (!repo || !token) {
      return { skipped: "not_configured" };
    }

    const path = env.GITHUB_DAILY_PATH?.trim() || "archive/daily";
    const namespace = resolveGithubDailyNamespace(env);
    const { yesterday, today } = getClientTzDates();

    const candidateDates = INGEST_TODAY_WITHOUT_DEDUP ? [yesterday, today] : [yesterday];
    const result: GithubDailyPullResult = {
      repo,
      dates: candidateDates,
      fetched: 0,
      parsed: 0,
      ingested: 0,
      errors: []
    };

    for (const date of candidateDates) {
      const key = cursorKey(repo, date);
      const isToday = date === today;

      if (!isToday) {
        const existing = await readCursor(env.DB, key);
        if (existing) continue;
      }

      const fetched = await fetchDailyMarkdown(env, { repo, path, date, token });
      if (fetched.status === "auth_failed") {
        console.error("github daily pull auth failed", { repo, date });
        return { ...result, skipped: "auth_failed" };
      }
      if (fetched.status === "missing") continue;
      if (fetched.status === "error") {
        result.errors?.push(`${date}: ${fetched.message}`);
        continue;
      }

      result.fetched = (result.fetched ?? 0) + 1;

      let entries: ParsedDailyEntry[] = [];
      try {
        entries = parseDailyMarkdown(fetched.markdown);
      } catch (error) {
        result.errors?.push(`${date}: parse failed ${String(error)}`);
        continue;
      }

      result.parsed = (result.parsed ?? 0) + entries.length;

      let ingested = 0;
      try {
        ingested = await ingestParsedEntries(env, { namespace, date, entries });
      } catch (error) {
        result.errors?.push(`${date}: ingest failed ${String(error)}`);
        continue;
      }

      result.ingested = (result.ingested ?? 0) + ingested;

      if (!isToday) {
        try {
          await writeCursor(env.DB, key, new Date().toISOString());
        } catch (error) {
          result.errors?.push(`cursor write failed: ${String(error)}`);
        }
      }
    }

    return result;
  } catch (error) {
    console.error("github daily pull unexpected error", error);
    return {
      skipped: "error",
      errors: [String(error)]
    };
  }
}