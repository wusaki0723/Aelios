import { loadConfig, speakersForNamespace, type DreamSpeakers } from "../gateway/config";
import type { Env, MessageRecord } from "../types";
import { cleanMessageText } from "../utils/sanitize";

export type { DreamSpeakers };

export async function loadSpeakersForNamespace(env: Env, namespace: string): Promise<DreamSpeakers | null> {
  try {
    return speakersForNamespace(await loadConfig(env), namespace);
  } catch {
    return null;
  }
}

export function speakerLabel(role: string, speakers: DreamSpeakers | null): string {
  if (role === "assistant") return speakers?.assistantName ?? "我(助手)";
  return speakers?.userName ?? "用户";
}

export function formatSpeakerTranscript(
  messages: MessageRecord[],
  speakers: DreamSpeakers | null,
  maxChars: number,
  ellipsis = false
): string {
  return messages
    .map((message) => {
      const text = cleanMessageText(message.content);
      const clipped = text.length <= maxChars ? text : ellipsis ? `${text.slice(0, maxChars)}…` : text.slice(0, maxChars);
      return `[${message.id}][${message.created_at}][${speakerLabel(message.role, speakers)}] ${clipped}`;
    })
    .join("\n\n");
}

export function nameOnlyRule(speakers: DreamSpeakers): string {
  return `只许用「${speakers.userName}」和「${speakers.assistantName}」指称双方。禁止出现 user、用户、assistant、助手，也不要用「你」「我」代替这两人。`;
}

export function diarySpeakerRules(speakers: DreamSpeakers | null): string[] {
  if (!speakers) {
    return ["- 用「我」指代助手自己；提到用户时用「她」或具体称呼，不要用「用户」。"];
  }
  return [
    `- 说话人：用户是${speakers.userName}，助手是${speakers.assistantName}。下面 transcript 已用这两个名字标注角色。`,
    `- 这是${speakers.assistantName}写给自己的日记。提到对方必须写「${speakers.userName}」，提到自己写「${speakers.assistantName}」。${nameOnlyRule(speakers)}`
  ];
}

export function rollupSpeakerRule(speakers: DreamSpeakers | null): string {
  if (!speakers) {
    return "- 站在「我=助手」视角；关于用户用「你」，关于助手承诺用「我需要」。";
  }
  return `- 说话人：用户是${speakers.userName}，助手是${speakers.assistantName}。${nameOnlyRule(speakers)}`;
}
