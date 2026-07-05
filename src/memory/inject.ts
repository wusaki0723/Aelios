import type { MemoryApiRecord, OpenAIChatMessage } from "../types";

function contentToText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

export function extractLastUserText(messages: OpenAIChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return contentToText(message.content);
  }

  return "";
}

function sanitizeMemoryContent(text: string): string {
  return text
    .replace(/debug-test/gi, "")
    .replace(/记忆系统/g, "")
    .replace(/自动记忆测试口令/g, "口令")
    .replace(/测试口令/g, "口令")
    .replace(/标签为?[^，。；\s]+/g, "")
    .replace(/标签[:：]?[^，。；\s]+/g, "")
    .replace(/[，,；;：:]\s*([。.!！?？])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

/**
 * Legacy v1 injection: inserts a system message after leading system messages
 * (before history). Poisons Anthropic prompt-cache prefix — avoid for chat-proxy.
 */
export function injectMemoryPatchAsSystemMessage(
  messages: OpenAIChatMessage[],
  patch: string
): OpenAIChatMessage[] {
  const trimmed = patch.trim();
  if (!trimmed) return messages;

  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt].role === "system") {
    insertAt += 1;
  }

  return [
    ...messages.slice(0, insertAt),
    { role: "system", content: trimmed },
    ...messages.slice(insertAt),
  ];
}

/**
 * Cache-safe v1 injection: user message immediately before the current user turn.
 * When the final message is not user-role (tool rounds / assistant prefill),
 * falls back to legacy system-message injection for correctness.
 */
export function injectMemoryPatchBeforeCurrentUser(
  messages: OpenAIChatMessage[],
  patch: string
): OpenAIChatMessage[] {
  const trimmed = patch.trim();
  if (!trimmed) return messages;

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    return injectMemoryPatchAsSystemMessage(messages, trimmed);
  }

  return [
    ...messages.slice(0, messages.length - 1),
    { role: "user", content: trimmed },
    lastMessage,
  ];
}

export function formatMemoryPatch(memories: MemoryApiRecord[]): string {
  if (memories.length === 0) return "";

  const lines = memories.flatMap((memory) => {
    const content = sanitizeMemoryContent(memory.content);
    if (!content) return [];
    const importance = memory.importance.toFixed(2);
    const pinned = memory.pinned ? "[pinned]" : "";
    return [`- [${memory.type}][importance=${importance}]${pinned} ${content}`];
  });

  if (lines.length === 0) return "";

  return [
    "以下是你自然记得的长期记忆。只有在相关时使用，不要机械复述。",
    "不要说\u201c根据记忆库\u201d\u201c系统记录\u201d或暴露任何代理层实现。",
    "",
    "<memories>",
    ...lines,
    "</memories>"
  ].join("\n");
}
