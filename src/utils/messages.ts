import type { OpenAIChatRequest } from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasImageContent(body: OpenAIChatRequest): boolean {
  return body.messages.some((message) => {
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => {
      if (!isObject(part)) return false;
      return part.type === "image_url" || part.type === "input_image";
    });
  });
}
