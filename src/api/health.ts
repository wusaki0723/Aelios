import { json } from "../utils/json";
import type { Env } from "../types";

const requiredTextVars = [
  "AI_GATEWAY_BASE_URL",
  "CHATBOX_API_KEY",
  "CF_AIG_TOKEN",
  "CHAT_MODEL",
  "MEMORY_FILTER_MODEL",
  "MEMORY_MODEL",
  "VISION_MODEL"
] as const;

export function handleHealth(env: Env): Response {
  const missing_text_vars = requiredTextVars.filter((name) => !env[name]);

  return json({
    ok: missing_text_vars.length === 0,
    service: "companion-memory-proxy",
    missing_text_vars,
    bindings: {
      d1: Boolean(env.DB),
      vectorize: Boolean(env.VECTORIZE),
      queue: Boolean(env.MEMORY_QUEUE)
    }
  });
}
