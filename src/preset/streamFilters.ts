/**
 * Stream content filters with a small state machine for <thinking>/<think> tag stripping
 * and dash collapsing.
 *
 * Handles:
 * - <thinking>...</thinking> and <think>...</think> stripped across chunk boundaries
 * - unclosed <thinking>/<think> tags are treated as model formatting mistakes:
 *   the tag is removed, but the following visible text is flushed at stream end
 * - dash_to_comma: ——|—|– → "，" with consecutive dash collapsing
 *   (——, ———, ——– all produce a single "，", even across chunks)
 * - strip_solid_square: ■ → "" (single-char, immediate)
 *
 * Design:
 * - IDLE state: buffer characters that might be part of an opening think tag.
 *   If buffer matches an opening tag prefix, keep buffering.
 *   If buffer is a full opening tag, switch to INSIDE_THINKING.
 *   Otherwise flush via applySingleCharRules.
 * - INSIDE_THINKING state: consume everything until the matching close tag is found.
 * - Dash collapsing: consecutive dashes are held in a buffer and flushed
 *   as a single "，" when a non-dash arrives. A trailing dash at chunk
 *   boundary is held in `pendingDash` to support cross-chunk collapsing.
 *
 * IMPORTANT: reasoning_content is NOT processed here. This filter only
 * runs on visible content deltas. The caller is responsible for routing
 * reasoning_content around this filter.
 */

const THINKING_TAGS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" }
] as const;

type StreamFilterState = "IDLE" | "INSIDE_THINKING";

export interface ThinkingFilterState {
  state: StreamFilterState;
  buffer: string;
  closeTag: string | null;
  thinkingContent: string;
  /** true if previous chunk ended with an unresolved dash (pending cross-chunk collapse) */
  pendingDash: boolean;
}

export function createThinkingFilterState(): ThinkingFilterState {
  return { state: "IDLE", buffer: "", closeTag: null, thinkingContent: "", pendingDash: false };
}

function isDash(ch: string): boolean {
  return ch === "—" || ch === "–";
}

/**
 * Apply non-dash single-character stream rules to a character.
 * Returns the replacement string ("" to delete, or the character itself).
 * Dash handling is done separately by the dash-collapsing logic.
 */
function applySingleCharRules(ch: string): string {
  if (ch === "■") return "";
  return ch;
}

/**
 * Flush a completed dash run: output a single "，" if there were any dashes.
 */
function flushDashRun(hasDash: boolean, output: string): string {
  if (hasDash) return output + "，";
  return output;
}

function matchingOpenTag(buffer: string): (typeof THINKING_TAGS)[number] | null {
  return THINKING_TAGS.find((tag) => tag.open === buffer) ?? null;
}

function isOpeningTagPrefix(buffer: string): boolean {
  return THINKING_TAGS.some((tag) => tag.open.startsWith(buffer));
}

function applyVisibleTextRules(text: string): string {
  return text.replace(/■/g, "").replace(/[—–]+/g, "，");
}

/**
 * Process a single visible content chunk through the stream filter.
 *
 * Handles <thinking> tag stripping across chunk boundaries,
 * dash collapsing (consecutive dashes → single "，"), and
 * ■ deletion.
 *
 * Returns the filtered text to send to the client, or null if
 * the entire chunk was consumed by thinking content.
 */
export function processStreamChunk(
  chunk: string,
  state: ThinkingFilterState
): string | null {
  if (!chunk) return null;

  let output = "";
  // Track whether we're in a consecutive dash run within this chunk.
  // If pendingDash is true from the last chunk, we start with an active run.
  let inDashRun = state.pendingDash;
  state.pendingDash = false;

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];

    if (state.state === "IDLE") {
      // --- Dash collapsing ---
      if (isDash(ch)) {
        inDashRun = true;
        continue; // Don't output yet — wait for non-dash to collapse.
      }

      // Non-dash character. If we had a pending dash run, flush it as a single "，".
      if (inDashRun) {
        output += "，";
        inDashRun = false;
      }

      // --- <thinking>/<think> tag detection ---
      state.buffer += ch;

      if (isOpeningTagPrefix(state.buffer)) {
        const tag = matchingOpenTag(state.buffer);
        if (tag) {
          state.state = "INSIDE_THINKING";
          state.closeTag = tag.close;
          state.thinkingContent = "";
          state.buffer = "";
        }
        continue;
      }

      // Buffer is NOT a prefix of a thinking tag. Flush characters.
      while (state.buffer.length > 0 && !isOpeningTagPrefix(state.buffer)) {
        output += applySingleCharRules(state.buffer[0]);
        state.buffer = state.buffer.slice(1);
      }

      const tag = matchingOpenTag(state.buffer);
      if (tag) {
        state.state = "INSIDE_THINKING";
        state.closeTag = tag.close;
        state.thinkingContent = "";
        state.buffer = "";
      }
      continue;
    }

    // INSIDE_THINKING state
    state.buffer += ch;

    const closeTag = state.closeTag || THINKING_TAGS[0].close;
    if (closeTag.startsWith(state.buffer)) {
      if (state.buffer === closeTag) {
        state.state = "IDLE";
        state.closeTag = null;
        state.thinkingContent = "";
        state.buffer = "";
      }
      continue;
    }

    // Not a prefix of the close tag. Keep it in case this was an unclosed
    // thinking tag that actually contains visible answer text.
    while (state.buffer.length > 0 && !closeTag.startsWith(state.buffer)) {
      state.thinkingContent += state.buffer[0];
      state.buffer = state.buffer.slice(1);
    }
  }

  // After processing all characters in the chunk, hold any trailing dash run.
  // We cannot know whether the next chunk starts with another dash, so flushing
  // here would make streaming diverge from non-streaming:
  // "text—" + "—more" must behave like "text——more" → "text，more".
  if (state.state === "IDLE" && inDashRun) {
    state.pendingDash = true;
  }

  // Flush any remaining buffer that's not a thinking-tag prefix.
  if (state.state === "IDLE" && state.buffer && !isOpeningTagPrefix(state.buffer)) {
    for (const bufCh of state.buffer) {
      output += applySingleCharRules(bufCh);
    }
    state.buffer = "";
  }

  return output || null;
}

/**
 * Called at the end of a stream to flush any pending dash that was held
 * for cross-chunk collapsing. Returns the final output character(s),
 * or "" if nothing to flush.
 */
export function flushPendingDash(state: ThinkingFilterState): string {
  if (state.pendingDash) {
    state.pendingDash = false;
    return "，";
  }
  return "";
}

/**
 * Flush any visible text held by the stream filter at stream end.
 *
 * Complete thinking blocks are removed. If a model emits an opening think tag
 * and never closes it, treat that as a formatting failure and preserve the text
 * after the tag instead of deleting the whole answer.
 */
export function flushStreamFilter(state: ThinkingFilterState): string {
  let output = "";

  if (state.state === "INSIDE_THINKING") {
    output += applyVisibleTextRules(state.thinkingContent + state.buffer);
    state.state = "IDLE";
    state.closeTag = null;
    state.thinkingContent = "";
    state.buffer = "";
  } else if (state.buffer) {
    output += applyVisibleTextRules(state.buffer);
    state.buffer = "";
  }

  return output + flushPendingDash(state);
}
