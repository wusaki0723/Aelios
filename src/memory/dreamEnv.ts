import type { Env } from "../types";
import { readPositiveInt, readString } from "./dreamUtils";

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MEMORY_CONTEXT_LIMIT = 40;
export const DEFAULT_EMPTY_MEMORY_MIN_CHARS = 4;
const DEFAULT_TIME_ZONE = "Asia/Singapore";

export function isDreamEnabled(env: Env): boolean {
  const dreamFlag = readString(env.ENABLE_DREAM);
  if (dreamFlag) return dreamFlag !== "false";
  return env.ENABLE_DAILY_MEMORY_DIGEST !== "false";
}

export function readDreamStrategy(env: Env): "upsert" | "review" {
  const raw = env.DREAM_STRATEGY;
  if (raw === "review") return "review";
  return "upsert";
}

export function readFirstEnvValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";

export function readDreamModel(env: Env): string | null {
  return (
    readString(readFirstEnvValue(env.DREAM_MODEL, env.DAILY_DIGEST_MODEL, env.SUMMARY_MODEL)) ||
    DEFAULT_DREAM_MODEL
  );
}

export function readDreamTimeZone(env: Env): string {
  return readString(readFirstEnvValue(env.DREAM_TIME_ZONE, env.DAILY_DIGEST_TIME_ZONE)) || DEFAULT_TIME_ZONE;
}

export function readDreamMaxMessages(env: Env): number {
  return readPositiveInt(
    readFirstEnvValue(env.DREAM_MAX_MESSAGES, env.DAILY_DIGEST_MAX_MESSAGES),
    DEFAULT_MAX_MESSAGES,
    1000
  );
}

export function readDreamMaxTokens(env: Env): number {
  return readPositiveInt(readFirstEnvValue(env.DREAM_MAX_TOKENS, env.DAILY_DIGEST_MAX_TOKENS), 3000, 8000);
}

export function readDreamMemoryContextLimit(env: Env): number {
  return readPositiveInt(
    readFirstEnvValue(env.DREAM_MEMORY_CONTEXT_LIMIT, env.DAILY_DIGEST_MEMORY_CONTEXT_LIMIT),
    DEFAULT_MEMORY_CONTEXT_LIMIT,
    1000
  );
}

export function readDreamTimeZoneFromEnv(env: Env): string {
  return readDreamTimeZone(env);
}
