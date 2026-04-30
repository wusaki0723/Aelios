/**
 * Default regex rules for the v4 Regex Pipeline.
 *
 * Exactly 4 rules. Single-tag or single-character. No greedy cross-chunk rules.
 * dash_to_comma is a hard requirement — em dash / en dash / Chinese double dash
 * are all replaced with "，".
 */

export interface RegexRule {
  id: string;
  find: RegExp;
  replace: string;
  /** Where this rule applies: visible content, stream content, or history preprocessing. */
  applyTo: ("content" | "stream" | "history")[];
}

const STRIP_THINKING: RegexRule = {
  id: "strip_thinking",
  find: /<(thinking|think)>[\s\S]*?<\/\1>|<\/?(?:thinking|think)>/g,
  replace: "",
  applyTo: ["content", "history"],
};

const STRIP_LANG_DETAILS: RegexRule = {
  id: "strip_lang_details",
  find:
    /<details>\s*<summary>(英文版|日本語版|English|Japanese)<\/summary>[\s\S]*?<\/details>/g,
  replace: "",
  applyTo: ["content"],
};

const STRIP_SOLID_SQUARE: RegexRule = {
  id: "strip_solid_square",
  find: /■/g,
  replace: "",
  applyTo: ["content", "stream"],
};

const DASH_TO_COMMA: RegexRule = {
  id: "dash_to_comma",
  find: /——|—|–/g,
  replace: "，",
  applyTo: ["content", "stream"],
};

/**
 * All 4 default rules in execution order.
 * Order matters: strip_thinking runs first to remove whole blocks,
 * then strip_lang_details, then character-level replacements.
 */
export const DEFAULT_RULES: readonly RegexRule[] = [
  STRIP_THINKING,
  STRIP_LANG_DETAILS,
  STRIP_SOLID_SQUARE,
  DASH_TO_COMMA,
];

/**
 * Rules that apply to visible assistant content (non-stream batch processing).
 */
export const CONTENT_RULES: readonly RegexRule[] = DEFAULT_RULES.filter((r) =>
  r.applyTo.includes("content")
);

/**
 * Rules that apply to stream-visible content (single-char replacements only,
 * plus the stream state machine handles <thinking> tag stripping).
 */
export const STREAM_SINGLE_CHAR_RULES: readonly RegexRule[] = DEFAULT_RULES.filter(
  (r) => r.applyTo.includes("stream")
);

/**
 * Rules that apply to history message preprocessing.
 * Only strip_thinking — we don't rewrite history text beyond that.
 */
export const HISTORY_RULES: readonly RegexRule[] = DEFAULT_RULES.filter((r) =>
  r.applyTo.includes("history")
);
