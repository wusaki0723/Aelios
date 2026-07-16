import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getRelationsGraph } from "../db/v2";
import type { Env } from "../types";
import { json, openAiError } from "../utils/json";
import { readPositiveInt, resolveNamespace } from "../utils/request";

/**
 * GET /api/relations/graph
 * Query: namespace (default profile/default), limit (default 400, max 800)
 */
export async function handleRelationsGraph(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  if (request.method !== "GET") return openAiError("Method not allowed", 405);

  const scopeError = requireScope(auth.profile, "memory:read");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const limit = readPositiveInt(url.searchParams.get("limit"), 400, 800);

  try {
    const graph = await getRelationsGraph(env.DB, { namespace, limit });
    return json({
      nodes: graph.nodes,
      edges: graph.edges,
      meta: graph.meta
    });
  } catch (error) {
    console.error("relations graph failed", { namespace, error });
    return openAiError(
      error instanceof Error ? error.message : "relations graph failed",
      500,
      "memory_error"
    );
  }
}
