/**
 * Shared model call helper: single retry+backoff loop used by the nightly
 * memory jobs (weekly/monthly rollup, diary writer, candidate judge).
 *
 * Returns the raw model text (content, falling back to reasoning_content).
 * Callers keep their own JSON parsing, result normalization and model-name
 * resolution. Throws after the final retry.
 */
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, OpenAIChatRequest, OpenAIChatResponse } from "../types";

export const MODEL_RETRY_BACKOFF_MS = [2000, 8000];

const DEFAULT_SYSTEM_PROMPT = "你是严格的 JSON 生成器。你只输出 JSON，不要输出思考过程。";

export interface ModelCallRequest {
  model: string;
  prompt: string;
  maxTokens?: number;
  backoffMs?: number[]; // default [2000, 8000]; pass [] for a single attempt
  systemPrompt?: string; // default JSON-generator system prompt
  logPrefix?: string; // default "model_call"
  logMeta?: Record<string, unknown>;
}

export class ModelCallError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelCallError";
    this.status = status;
  }
}

/**
 * Read the first non-empty string env var from `keys`, else `fallback`.
 * Callers still own which keys/fallback to use — the original model readers
 * were near-identical but not byte-identical, so only this lookup pattern is unified.
 */
export function readModelName(env: Env, keys: string[], fallback: string): string {
  const record = env as unknown as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableModelStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function callModelWithRetry(env: Env, req: ModelCallRequest): Promise<string> {
  const backoffMs = req.backoffMs ?? MODEL_RETRY_BACKOFF_MS;
  const logPrefix = req.logPrefix ?? "model_call";
  const maxAttempts = 1 + backoffMs.length;
  const startedAt = Date.now();

  const request: OpenAIChatRequest = {
    model: req.model,
    messages: [
      { role: "system", content: req.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
      { role: "user", content: req.prompt }
    ],
    temperature: 0,
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    response_format: { type: "json_object" },
    stream: false
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const waitMs = backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 8000;
      console.warn(`${logPrefix}: retrying model call after non-ok response`, {
        ...req.logMeta,
        model: req.model,
        attempt: attempt + 1,
        maxAttempts,
        backoffMs: waitMs
      });
      await delay(waitMs);
    }

    try {
      const response = await callOpenAICompat(env, request);
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        const retriable = isRetriableModelStatus(response.status);
        console.error(`${logPrefix}: model returned non-ok`, {
          ...req.logMeta,
          model: req.model,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          attempt: attempt + 1,
          retriable
        });
        if (retriable && attempt < maxAttempts - 1) continue;
        throw new ModelCallError(`model returned status ${response.status}`, response.status);
      }

      const parsed = (await response.json()) as OpenAIChatResponse;
      const message = parsed.choices?.[0]?.message as
        | ({ content?: unknown; reasoning_content?: unknown })
        | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      return content || reasoning;
    } catch (error) {
      if (error instanceof ModelCallError) throw error;
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error && error.message ? error.message : String(error);
      console.error(`${logPrefix} model failed`, {
        ...req.logMeta,
        model: req.model,
        elapsedMs,
        attempt: attempt + 1,
        error: message
      });
      if (attempt < maxAttempts - 1) continue;
      throw error;
    }
  }

  throw new ModelCallError("model call failed after retries");
}
