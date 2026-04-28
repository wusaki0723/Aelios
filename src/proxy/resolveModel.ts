import type { Env, KeyProfile } from "../types";

export function resolveTargetModel(requestModel: string, profile: KeyProfile, env: Env): string {
  const publicModel = env.PUBLIC_MODEL_NAME || "companion";
  const defaultModel = env.CHAT_MODEL || env.DEFAULT_UPSTREAM_MODEL;
  const globalPassthrough = env.ALLOW_MODEL_PASSTHROUGH === "true";

  if (!defaultModel) {
    throw new Error("Missing CHAT_MODEL");
  }

  if (!requestModel || requestModel === publicModel) {
    return defaultModel;
  }

  if (profile.allowModelPassthrough || globalPassthrough) {
    return requestModel;
  }

  return defaultModel;
}

export function classifyProvider(model: string): "anthropic" | "openai-compatible" {
  const value = model.toLowerCase();
  return value.includes("anthropic") || value.includes("claude") ? "anthropic" : "openai-compatible";
}
