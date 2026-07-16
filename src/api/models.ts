import { authenticate } from "../auth/apiKey";
import type { Env } from "../types";
import { json, openAiError } from "../utils/json";

export async function handleModels(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const publicModel = env.PUBLIC_MODEL_NAME || "companion";

  return json(
    {
      object: "list",
      data: [
        {
          id: publicModel,
          object: "model",
          created: 0,
          owned_by: "companion-memory-proxy"
        }
      ]
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
