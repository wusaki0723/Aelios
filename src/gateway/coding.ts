import { object } from "./config";
import type { Body } from "./protocol";

/**
 * Coding agents (Claude Code, Codex, Cline, opencode…) keep their memory, but only of what was said.
 * Each tool step is its own request, and what it carries is about the code, not the relationship.
 * So for a coding request the gateway records:
 *  - the person's words with code blocks replaced by [code];
 *  - a reply that called no work tool, with code blocks replaced the same way as the text streams in,
 *    so a long block never fills the 8,000-character cap before the words after it;
 *  - from a step that called a work tool, only its speech tool calls (a message sent through a
 *    tool), with code in what they say replaced too. A speech tool's name is made only of the words
 *    below; every other tool is work, so tool names nobody listed stay out. Work tool arguments never
 *    enter the record, so they cannot crowd out or outgrow the cap. A finished step left with nothing
 *    writes no new rows (it only closes an earlier failed try of the same request); a failed one is
 *    still recorded as failed.
 * Recall still runs on the person's turns only, and searches without the code.
 * An assistant can switch this off with `codingFilter: false` to record everything as before.
 *
 * A request counts as coding when either signal is present:
 *  - the client names itself in its User-Agent or attribution headers;
 *  - the request offers both a shell tool and a file-editing tool.
 */
const CLIENT_HEADERS = ["user-agent", "x-title", "http-referer", "referer", "originator"];
const CLIENT_RE = /claude-cli|claude-code|codex|opencode|kilo[ -]?code|kilocode\.ai|\bcline\b|roo[ -]?code|\baider\b|charm-crush|qwen-?code/i;

// Names are compared lowercased with separators and trailing version dates removed,
// so "Bash", "bash_20250124" and "run-terminal-cmd" line up with the lists below.
const SHELL_TOOLS = new Set(["bash", "shell", "localshell", "executecommand", "runterminalcmd", "runcommand",
  "runshellcommand", "execcommand", "exec", "terminal"]);
const EDIT_TOOLS = new Set(["edit", "multiedit", "write", "applypatch", "strreplaceeditor", "strreplacebasededittool",
  "texteditor", "writetofile", "replaceinfile", "editfile", "applydiff", "createfile", "insertcontent",
  "searchandreplace", "notebookedit", "writefile", "patch"]);
// A speech tool says something to someone: its name has one of these words, and every other word is
// one of the second set (who or where it goes). "send_patch", "sendKeys" and "commit_message" are work.
const SPEECH_WORDS = new Set(["send", "reply", "respond", "message", "messages", "msg", "notify", "notification",
  "speak", "say", "tell", "talk", "voice", "tts", "sticker", "dm"]);
const SPEECH_CONTEXT = new Set(["to", "the", "a", "user", "owner", "human", "her", "him", "them", "text", "chat", "im",
  "private", "group", "channel", "room", "friend", "contact", "partner", "wife", "husband", "audio", "image", "photo",
  "picture", "emoji", "reaction", "react", "card", "push", "bot", "final", "proactive", "weixin", "wechat", "wx",
  "telegram", "tg", "qq", "discord", "slack", "line", "whatsapp", "signal", "imessage", "sms", "feishu", "lark",
  "dingtalk", "kook", "matrix", "email", "mail", "onebot", "napcat"]);

function normalize(name: unknown): string {
  return typeof name === "string" ? name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "") : "";
}

/** Every name a tool definition answers to, across Chat Completions, Messages and Responses shapes. */
function toolNames(tool: unknown): string[] {
  if (!object(tool)) return [];
  return [tool.name, tool.type, object(tool.function) ? tool.function.name : undefined].map(normalize).filter(Boolean);
}

/** Why this request looks like a coding agent, or null. */
export function codingClient(headers: Headers, body: Body): string | null {
  for (const name of CLIENT_HEADERS) {
    const match = headers.get(name)?.match(CLIENT_RE);
    if (match) return `client:${match[0].toLowerCase()}`;
  }
  return codingTools(body);
}

/**
 * The same judgment for the hook endpoints, which have no client headers: the agent id the caller
 * passes (magpie's ctx.agent, such as "claude", "codex", "opencode" or "kilo") plays the client header.
 */
export function codingAgent(agent: unknown, body: Body): string | null {
  if (agent === "claude") return "agent:claude";
  const match = typeof agent === "string" ? agent.match(CLIENT_RE) ?? agent.match(/\bkilo\b/i) : null;
  if (match) return `agent:${match[0].toLowerCase()}`;
  return codingTools(body);
}

/** Both a shell tool and a file-editing tool on offer. */
function codingTools(body: Body): string | null {
  const names = new Set((Array.isArray(body.tools) ? body.tools : []).flatMap(toolNames));
  const shell = [...names].find(name => SHELL_TOOLS.has(name));
  const edit = [...names].find(name => EDIT_TOOLS.has(name));
  return shell && edit ? `tools:${shell}+${edit}` : null;
}

/** Whether a tool call says something to someone (see the header). MCP server names are not judged. */
export function isSpeechTool(name: string): boolean {
  const tool = /^mcp__/i.test(name) ? name.slice(name.lastIndexOf("__") + 2) : name;
  const words = tool.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word && !/^v?\d+$/.test(word));
  return words.some(word => SPEECH_WORDS.has(word)) &&
    words.every(word => SPEECH_WORDS.has(word) || SPEECH_CONTEXT.has(word));
}

/**
 * Turns fenced code blocks into [code] as text streams through, keeping only a few characters of
 * the current line. As in CommonMark, a block opens at a line of three or more ` or ~ and closes at
 * a line of the same character at least as long, or runs to the end.
 */
export class CodeFilter {
  private head = "";
  private line: "open" | "text" | "drop" | null = null;
  private fence: { char: string; length: number } | null = null;
  constructor(private readonly emit: (text: string) => void) {}

  push(text: string): void {
    let start = 0;
    for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", start)) {
      this.feed(text.slice(start, nl));
      this.endLine(true);
      start = nl + 1;
    }
    this.feed(text.slice(start));
  }

  /** The text ends here, or a tool call comes next: an open block ends with it. */
  end(): void {
    this.endLine(false);
    this.fence = null;
  }

  private feed(piece: string): void {
    if (!piece || this.line === "open" || this.line === "drop") return;
    if (this.line === "text") { this.emit(piece); return; }
    this.head += piece;
    const rest = this.head.replace(/^[ \t]*/, "");
    const run = /^(`+|~+)/.exec(rest)?.[0] || "";
    if (this.fence) {
      // Inside a block nothing is kept; a line is held only while it could still close the block.
      const closing = run.startsWith(this.fence.char) || !rest;
      if (!closing || rest.slice(run.length).trim() || this.head.length > 256) { this.line = "drop"; this.head = ""; }
    } else if (rest.length > run.length || this.head.length > 256) {
      // The run of fence characters has ended: three or more open a block, fewer are words.
      if (run.length >= 3) this.open(run);
      else { this.line = "text"; this.emit(this.head); this.head = ""; }
    }
  }

  private open(run: string): void {
    this.fence = { char: run[0], length: run.length };
    this.line = "open"; this.head = "";
    this.emit("[code]");
  }

  private endLine(newline: boolean): void {
    if (this.fence) {
      // A held line is fence characters and spaces only: it closes if the run is long enough.
      if (this.line === null && this.head.trim().length >= this.fence.length) {
        this.fence = null;
        if (newline) this.emit("\n");
      }
    } else if (this.line === "text") {
      if (newline) this.emit("\n");
    } else if (this.line === null) {
      const run = /^(`{3,}|~{3,})$/.exec(this.head.trim())?.[0];
      if (run) this.open(run);
      else if (this.head || newline) this.emit(newline ? `${this.head}\n` : this.head);
    }
    this.head = "";
    this.line = null;
  }
}

/** Fenced code blocks become [code]. */
export function replaceCode(text: string): string {
  let out = "";
  const filter = new CodeFilter(piece => { out += piece; });
  filter.push(text);
  filter.end();
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Fenced code blocks become [code]; code alone leaves "". */
export function stripCodeBlocks(text: string): string {
  const said = replaceCode(text);
  return said.replaceAll("[code]", "").trim() ? said : "";
}

/** A tool call's arguments with code in every string replaced by [code]. */
export function replaceCodeIn(value: unknown): unknown {
  if (typeof value === "string") return replaceCode(value);
  if (Array.isArray(value)) return value.map(replaceCodeIn);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceCodeIn(item)]));
  return value;
}

/** The words to search memories with: no code, no placeholders. */
export function recallWords(text: string): string {
  return stripCodeBlocks(text).replaceAll("[code]", " ").replace(/\s+/g, " ").trim();
}

/** What a coding agent's reply said, for the record (see the header), and whether it hit the cap. */
export function codingSpeech(out: { text: string; truncated: boolean; overflow: boolean; workCalls: number;
  spoken: string; spokenTruncated: boolean }): { text: string; truncated: boolean } {
  if (out.workCalls) return { text: out.spoken, truncated: out.overflow || out.spokenTruncated };
  return { text: stripCodeBlocks(out.text), truncated: out.truncated };
}
