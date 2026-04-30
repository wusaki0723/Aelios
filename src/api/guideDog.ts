import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { KEY_PROFILES } from "../config/keyProfiles";
import { buildOpenAICompatRequest, callOpenAICompat } from "../proxy/openaiAdapter";
import { resolveTargetModel } from "../proxy/resolveModel";
import type { Env, OpenAIChatRequest } from "../types";
import { openAiError } from "../utils/json";
import { hasImageContent } from "../utils/messages";

function resolveGuideDogModel(body: OpenAIChatRequest, env: Env): string {
  if (env.GUIDE_DOG_MODEL) return env.GUIDE_DOG_MODEL;
  if (hasImageContent(body) && env.VISION_MODEL) return env.VISION_MODEL;
  return resolveTargetModel(body.model, KEY_PROFILES.guideDog, env);
}

export async function handleGuideDogChatCompletions(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const scopeError = requireScope(auth.profile, "chat:proxy");
  if (scopeError) return scopeError;

  let body: OpenAIChatRequest;
  try {
    body = (await request.json()) as OpenAIChatRequest;
  } catch {
    return openAiError("Request body must be valid JSON", 400);
  }

  if (!Array.isArray(body.messages)) {
    return openAiError("messages must be an array", 400);
  }

  let targetModel: string;
  try {
    targetModel = resolveGuideDogModel(body, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve target model";
    return openAiError(message, 500);
  }

  let upstream: Response;
  try {
    upstream = await callOpenAICompat(env, buildOpenAICompatRequest(body, targetModel));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call upstream";
    return openAiError(message, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8"
    }
  });
}
