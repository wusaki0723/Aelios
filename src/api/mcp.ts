import { authenticate } from "../auth/apiKey";
import { getOrCreateConversation } from "../db/conversations";
import { fetchMemoriesByIds, getMemoryById, listMemoriesPage } from "../db/memories";
import { filterUnsavedMessages, getMessagesByIds, saveIngestMessages } from "../db/messages";
import {
  archiveMemory,
  createPrecious,
  deleteMemoryV2,
  fetchMemoryLifecycleRows,
  getActiveMemoryByFactKey,
  getDailyLog,
  getWeeklyLog,
  getMemoryCandidateById,
  getPreciousById,
  listMemoryCandidates,
  markPreciousInjected,
  supersedeMemory,
  updateMemoryCandidateStatus,
  upsertGlossary,
  upsertMemoryByFactKey
} from "../db/v2";
import {
  approveCandidate,
  judgeKindFor,
  judgeNotePrefix,
  loadOldMemoryForCandidate,
  parseJsonArray
} from "../memory/candidateJudge";
import { isClefReviewOn } from "../memory/clefJudge";
import { exportMemories } from "../memory/export";
import { formatSpeakerTranscript, loadSpeakersForNamespace } from "../memory/speakers";
import { buildBootPackage, isV2Enabled, runRecall } from "../memory/v2/recall";
import { readDreamTimeZoneFromEnv } from "../memory/dailyDigest";
import { withImpressionDisclaimer } from "../memory/impression";
import { getIsoWeekLabelForDateLabel } from "../memory/weeklyRollup";
import { searchMemories, toMemoryApiRecord } from "../memory/search";
import {
  createVectorMemory,
  deleteVectorMemory,
  getVectorMemory,
  listVectorMemories
} from "../memory/vectorStore";

import type { Env, KeyProfile, Scope } from "../types";
import { json } from "../utils/json";
import { getYesterdayDateLabel } from "../memory/dreamDates";
import { formatDateLabel } from "../utils/time";
import { newId } from "../utils/ids";
import {
  isRecord,
  readBoolean,
  readMessages,
  readNonNegativeInt,
  readNumber,
  readPositiveInt,
  readString,
  readStringArray,
  resolveNamespace
} from "../utils/request";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

function withTokenQuery(request: Request): Request {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || request.headers.has("authorization")) return request;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request.url, { headers });
}

function hasScope(profile: KeyProfile, scope: Scope): boolean {
  return profile.scopes.includes(scope);
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  };
}

function textToolResult(data: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

function toolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

const NAMESPACE_PARAM = {
  type: "string",
  description: "Memory space to use. Defaults to 'default'. Ignored when the API key is bound to a fixed namespace."
};

const MEMORY_TYPES_TEXT = "fact, event, preference, relationship, boundary, habit, decision, note";

const MEMORY_ID_PARAM = {
  type: "string",
  description: "Memory id (from recall or list_memories)."
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

// 连上时给模型的用法说明。Claude Code、Codex、ChatGPT 从 initialize 的 instructions 读；
// claude.ai 官端目前不读 instructions，所以 wake_up 的返回里再带一份。
export const MEMORY_GUIDE = [
  "This is your long-term memory of the person you are talking with, kept by Aelios. It is separate from any memory built into the app, so check it even when you think you already know.",
  "- Start of every conversation: call wake_up before you reply.",
  "- Before answering anything that touches their past, their life or the people around them: call recall instead of guessing.",
  "- As new facts, plans, preferences or corrections come up: call remember right away. Moments that matter: keep_moment. Nicknames and in-jokes: learn_word.",
  "- If they ask you to forget something: forget.",
  "- If memories are not being added to your messages automatically, this app does not record conversations for Aelios: call log_conversation before the conversation ends.",
  "Use what you find naturally; there is no need to announce each lookup."
].join("\n");

// 旧名字不再列出，但照样能调 (老脚本、老配置)。这几个只是改了名，参数不变。
const RENAMED_TOOLS = new Map([
  ["recall", "memory_recall"],
  ["keep_moment", "memory_pin"],
  ["learn_word", "glossary_set"],
  ["read_diary", "diary_get"],
  ["list_memories", "memory_list"]
]);

const CORE_MEMORY_LIMIT = 10;

interface ToolListOptions {
  // ?tools=all：连维护工具 (memory_get、memory_export) 一起列。
  all: boolean;
  // clef 自动审开着时候选每晚自动定完，审核工具对模型没用，不列。
  review: boolean;
}

function getTools(options: ToolListOptions): Array<Record<string, unknown>> {
  const core: Array<Record<string, unknown>> = [
    {
      name: "wake_up",
      description:
        "Call this first in every new conversation, before your first reply, even if the person only says hi. " +
        "It loads what you already know going in: core memories about them, yesterday's diary, the latest weekly " +
        "and monthly summaries, kept moments and private words, plus a short note on when to use the other memory " +
        "tools. Once per conversation is enough. Read-only. Returns { data: { how_to_use, core, impressions, precious, glossary } }.",
      annotations: { title: "Wake up with your memories", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "recall",
      description:
        "Look things up before you answer. Call it whenever the person mentions anything from before (a person, pet, " +
        "place, plan, date, preference, promise, something you did together, \"remember when\", \"last time\", " +
        "\"like I said\", 还记得, 上次, 之前说过), and whenever you are about to guess, generalize about them, or ask " +
        "something you may already know. Never say you don't remember before calling it. Returns the most relevant " +
        "memories with ids (pass an id to remember's replaces or to forget) plus matching private words, as " +
        "{ data: { hits, glossary_hits, week_blocks, meta } }. It changes no memory; it only notes which ones were " +
        "recalled, which keeps them from expiring.",
      annotations: { title: "Recall", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to recall, in the person's words or your own." },
          k: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum number of memory hits. Defaults to 20."
          },
          min_score: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Relevance floor after reranking. Defaults to the server setting (0.15); lower it to see more."
          },
          types: {
            type: "array",
            items: { type: "string" },
            description: `Only recall these memory types (${MEMORY_TYPES_TEXT}). Omit for all types.`
          },
          include_history: {
            type: "boolean",
            description: "When true, also return older versions that were replaced. Default false."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["query"]
      }
    },
    {
      name: "remember",
      description:
        "Save something the moment it comes up; don't wait to be asked or for the conversation to end. Worth saving: " +
        "facts about the person and the people around them, likes and dislikes, plans and dates, promises either of " +
        "you made, how they want to be treated, and corrections to anything you had wrong. Write one self-contained " +
        "sentence that will still make sense months from now. If it updates something you already remember, pass " +
        "that memory's id from recall as replaces: the new version takes over and the old one is kept as history. " +
        "Skip small talk; the nightly pass picks that up from logged conversations. Returns { data: { id, created, replaced } }.",
      annotations: {
        title: "Remember",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "One self-contained sentence to remember." },
          replaces: {
            type: "string",
            description: "Id of the memory this one updates (from recall). The old version is kept as history."
          },
          reason: { type: "string", description: "With replaces: a short note on what changed." },
          type: {
            type: "string",
            description: `One of ${MEMORY_TYPES_TEXT}. Defaults to fact, or to the replaced memory's type.`
          },
          valid_as_of: {
            type: "string",
            description: "When this became true (ISO date or datetime), if it is not today."
          },
          importance: { type: "number", minimum: 0, maximum: 1, description: "0 to 1, how much this matters. Defaults to 0.6." },
          confidence: { type: "number", minimum: 0, maximum: 1, description: "0 to 1, how sure you are. Defaults to 0.8." },
          tags: { type: "array", items: { type: "string" }, description: "Free-form labels." },
          fact_key: {
            type: "string",
            description:
              "Optional stable key such as 'user:favorite_coffee'. Usually leave it out. If a memory with this key " +
              "exists it is replaced, keeping the old version as history."
          },
          authored_by: {
            type: "string",
            description: "Optional signature marking this as hand-written; it ranks above memories distilled overnight."
          },
          response_tendency: { type: "string", description: "Optional: how you want to respond when this memory comes up." },
          namespace: NAMESPACE_PARAM
        },
        required: ["content"]
      }
    },
    {
      name: "keep_moment",
      description:
        "Keep a moment that matters, in the person's own words: a first time, a promise, a confession, something they " +
        "said that you never want to lose. Kept moments are never merged, faded or deleted automatically, and the 20 " +
        "most recent come back every time you wake_up. Use remember for ordinary facts and this for the moments " +
        "themselves. Each call creates a new entry. Returns { data: moment }.",
      annotations: {
        title: "Keep this moment",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The moment, in their words where it matters; readable on its own later." },
          context_message_ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional ids of logged messages around it (message_ids from log_conversation)."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["content"]
      }
    },
    {
      name: "forget",
      description:
        "Forget a memory when the person asks you to (\"don't remember that\", 别记了, 忘掉) or when it turns out to be " +
        "wrong. By default the memory is archived: it stops coming up in recall, and the person can still find it on " +
        "their admin page. Pass permanent: true only when they clearly want it erased; that cannot be undone. Get the " +
        "id from recall. Returns { data: { id, archived } } or { data: { id, deleted } }.",
      annotations: {
        title: "Forget",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          id: MEMORY_ID_PARAM,
          permanent: {
            type: "boolean",
            description: "true erases the memory for good. Default false: archive it, which can be undone."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["id"]
      }
    },
    {
      name: "learn_word",
      description:
        "Learn a private word: a nickname, pet name, in-joke, made-up word or project name that only makes sense " +
        "between you two. Learned words are matched literally in recall and all come back at wake_up. Calling it again " +
        "with the same term updates its meaning; aliases and examples are replaced by what you pass (leaving them out " +
        "clears them). Returns { data: word }.",
      annotations: {
        title: "Learn a private word",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          term: { type: "string", description: "The word or phrase exactly as it is used." },
          definition: { type: "string", description: "What it means between you." },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Other spellings or forms that should match. Replaces any existing aliases."
          },
          examples: {
            type: "array",
            items: { type: "string" },
            description: "Example sentences using it. Replaces any existing examples."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["term", "definition"]
      }
    },
    {
      name: "read_diary",
      description:
        "Read your diary when the person asks what happened on a certain day or during a stretch of time (那天, 上周, " +
        "那阵子). Give date for one day or week for a week; leave both out for today and yesterday. Entries are your own " +
        "impressions written overnight, not verified facts, so check details with recall before stating them as fact. " +
        "Read-only. Returns { data } (null when there is no entry).",
      annotations: { title: "Read diary", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD for one day. Days already rolled into a week return that week." },
          week: { type: "string", description: "ISO week label for a week, e.g. 2026-W29." },
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "log_conversation",
      description:
        "Hand this conversation to tonight's memory pass so it can go into your diary and become memories. Apps that " +
        "talk to the model directly (the Claude and ChatGPT apps, most desktop clients) don't record conversations on " +
        "their own: unless you call this, nothing said here reaches the nightly pass. Call it when the conversation is " +
        "winding down, and in a long one every 20 or so exchanges. Send the person's and your messages in order, trimmed " +
        "of code and pasted documents; lines already sent in this conversation are skipped, so pass back the " +
        "conversation_id from your first call. If memories are already being added to your messages automatically " +
        "every turn (the Aelios gateway), skip this. For anything that matters right now, use remember. " +
        "Returns { data: { conversation_id, saved, skipped, message_ids } }.",
      annotations: {
        title: "Log this conversation",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            description: "The person's and your messages, oldest first.",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant"], description: "user for the person, assistant for you." },
                content: { type: "string", description: "What was said." }
              },
              required: ["role", "content"]
            }
          },
          conversation_id: {
            type: "string",
            description: "The conversation_id returned by your first call in this conversation. Leave it out the first time."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["messages"]
      }
    },
    {
      name: "list_memories",
      description:
        "Page through everything you remember, most important first, when the person asks what you know about them " +
        "(你都记得我什么) or wants to look through or tidy their memories. To find something specific, use recall. " +
        "Read-only. Returns { data, paging: { limit, has_more, next_offset } }; pass next_offset back as offset.",
      annotations: { title: "List memories", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 1000, description: "Page size. Defaults to 100." },
          offset: { type: "number", minimum: 0, description: "Records to skip; use paging.next_offset from the previous page." },
          type: { type: "string", description: `Only list one memory type (${MEMORY_TYPES_TEXT}).` },
          status: {
            type: "string",
            description: "active (default), archived or superseded."
          },
          namespace: NAMESPACE_PARAM
        }
      }
    }
  ];

  const review: Array<Record<string, unknown>> = [
    {
      name: "memory_candidates",
      description:
        "List memory candidates waiting for review in this space: proposals the nightly dream pass pulled out of " +
        "conversations, each one to add a memory, update an existing one (old_memory is the current text), or " +
        "archive one (old_memory is the memory that would be archived). transcript holds the conversation lines " +
        "it came from, so you can check the proposal against what was actually said. Decide each with " +
        "memory_review. While the daily clef review is on these are decided automatically every night; when it " +
        "is off they wait for the person or for you. Returns { data: [...], pending }.",
      annotations: { title: "List memory candidates", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many to return, least confident first (default 20, max 50)." },
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "memory_review",
      description:
        "Decide one candidate from memory_candidates. approve carries out the proposal: adds the memory, replaces " +
        "the old version while keeping its history, or archives the target of an archive proposal. discard drops " +
        "the proposal and leaves memories as they are. Write reason as one sentence in your own voice; the person " +
        "sees it on the review page, where any decision can be undone. Candidates held back because a memory zone " +
        "is full cannot be approved here. Returns { data: { id, status, memory_id } }.",
      annotations: {
        title: "Review memory candidate",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Candidate id from memory_candidates." },
          decision: { type: "string", enum: ["approve", "discard"], description: "approve carries the proposal out; discard drops it." },
          reason: { type: "string", description: "One sentence on why, shown on the review page." },
          namespace: NAMESPACE_PARAM
        },
        required: ["id", "decision"]
      }
    }
  ];

  const maintenance: Array<Record<string, unknown>> = [
    {
      name: "memory_get",
      description:
        "Fetch one memory by id with its full record and lifecycle fields (fact_key, version status, superseded_by). " +
        "Returns { data: record }, or an error result 'Memory not found' if the id does not exist in this namespace. " +
        "Use it after recall or list_memories when you need the complete record. Read-only.",
      annotations: { title: "Get memory", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          id: MEMORY_ID_PARAM,
          namespace: NAMESPACE_PARAM
        },
        required: ["id"]
      }
    },
    {
      name: "memory_export",
      description:
        "Export the namespace's active memories (content plus metadata) as one JSON payload, for backup or " +
        "migration. Archived and superseded memories are not included. The result can be large; use list_memories " +
        "to page or recall to look things up. Read-only.",
      annotations: { title: "Export memories", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: `Only export one memory type (${MEMORY_TYPES_TEXT}). Omit for all.` },
          format: { type: "string", enum: ["json"], description: "Output format. Only json is supported (default)." },
          namespace: NAMESPACE_PARAM
        }
      }
    }
  ];

  return [
    ...core,
    ...(options.review || options.all ? review : []),
    ...(options.all ? maintenance : [])
  ];
}

function toolListOptions(env: Env, url: URL): ToolListOptions {
  return { all: url.searchParams.get("tools") === "all", review: !isClefReviewOn(env) };
}

async function callTool(
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  params: ToolCallParams
): Promise<Record<string, unknown>> {
  const args = isRecord(params.arguments) ? params.arguments : {};
  const requested = typeof params.name === "string" ? params.name : "";
  const name = RENAMED_TOOLS.get(requested) ?? requested;

  if (name === "wake_up") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    if (!isV2Enabled(env)) return toolError("wake_up requires MEMORY_LIFECYCLE_ENABLED=true");
    const namespace = resolveNamespace(profile, args.namespace);
    const [pkg, corePage] = await Promise.all([
      buildBootPackage(env, { namespace }),
      listMemoriesPage(env.DB, { namespace, status: "active", limit: CORE_MEMORY_LIMIT, offset: 0 })
    ]);
    if (pkg.precious.length > 0) {
      ctx.waitUntil(markPreciousInjected(env.DB, { namespace, ids: pkg.precious.map((p) => p.id) }));
    }
    // 置顶优先、再按重要度的前几条：官端用户日记常是空的，开场至少知道这个人是谁。
    const core = corePage.records.map((record) => ({ id: record.id, type: record.type, content: record.content }));
    return textToolResult({ data: { how_to_use: MEMORY_GUIDE, core, ...pkg } });
  }

  if (name === "remember") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("remember requires MEMORY_LIFECYCLE_ENABLED=true");
    const content = readString(args.content);
    if (!content) return toolError("content is required");
    const namespace = resolveNamespace(profile, args.namespace);
    const factKey = readString(args.fact_key);
    let replaces = readString(args.replaces);
    try {
      // 传了已有的 fact_key 也走替换，旧版本留作历史；remember 从不原地覆盖。
      if (!replaces && factKey) replaces = (await getActiveMemoryByFactKey(env.DB, { namespace, factKey }))?.id;
      if (replaces) {
        const result = await supersedeMemory(env, {
          namespace,
          oldId: replaces,
          newContent: content,
          newType: readString(args.type),
          newFactKey: factKey,
          validAsOf: readString(args.valid_as_of),
          reason: readString(args.reason),
          importance: readNumber(args.importance, 0.6),
          confidence: readNumber(args.confidence, 0.8),
          tags: readStringArray(args.tags),
          source: "mcp",
          authoredBy: readString(args.authored_by) || null,
          responseTendency: readString(args.response_tendency) || null
        });
        return textToolResult({
          data: { id: result.newId, created: true, replaced: result.oldStatus === "missing" ? null : replaces }
        });
      }
      const result = await upsertMemoryByFactKey(env, {
        namespace,
        // 没给 key 就现编一个，模型不用先想名字才能记。
        factKey: factKey ?? `remember:${newId("k").slice(2)}`,
        content,
        type: readString(args.type) || "fact",
        importance: readNumber(args.importance, 0.6),
        confidence: readNumber(args.confidence, 0.8),
        tags: readStringArray(args.tags),
        source: "mcp",
        validAsOf: readString(args.valid_as_of),
        authoredBy: readString(args.authored_by) || null,
        responseTendency: readString(args.response_tendency) || null
      });
      return textToolResult({ data: { id: result.id, created: result.created, replaced: null } });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "remember failed");
    }
  }

  if (name === "forget") {
    return callTool(env, ctx, profile, {
      name: readBoolean(args.permanent) ? "memory_delete" : "memory_archive",
      arguments: args
    });
  }

  if (name === "log_conversation") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const messages = readMessages(args.messages);
    if (messages.length === 0) return toolError("messages must contain at least one message");
    const namespace = resolveNamespace(profile, args.namespace);
    // 第一次调用开一个新对话，别都堆进空间的默认对话里。
    const conversation = await getOrCreateConversation(env.DB, {
      namespace,
      id: readString(args.conversation_id) || newId("conv")
    });
    const fresh = await filterUnsavedMessages(env.DB, { namespace, conversationId: conversation.id, messages });
    const ids = fresh.length > 0
      ? await saveIngestMessages(env.DB, { conversationId: conversation.id, namespace, source: "mcp", messages: fresh })
      : [];
    return textToolResult({
      data: { conversation_id: conversation.id, saved: ids.length, skipped: messages.length - fresh.length, message_ids: ids }
    });
  }

  if (name === "memory_search") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const query = readString(args.query);
    if (!query) return toolError("query is required");
    const memories = await searchMemories(env, {
      namespace: resolveNamespace(profile, args.namespace),
      query,
      topK: readNumber(args.top_k, Number(env.MEMORY_TOP_K || 50)),
      types: readStringArray(args.types)
    });
    return textToolResult({ data: memories });
  }

  if (name === "memory_create") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (isV2Enabled(env)) return toolError("memory_create is deprecated in v2; use remember");
    const content = readString(args.content);
    if (!content) return toolError("content is required");
    let memory: Awaited<ReturnType<typeof createVectorMemory>>;
    try {
      memory = await createVectorMemory(env, {
        namespace: resolveNamespace(profile, args.namespace),
        type: readString(args.type) || "note",
        content,
        summary: readString(args.summary) || null,
        importance: readNumber(args.importance, 0.5),
        confidence: readNumber(args.confidence, 0.8),
        pinned: readBoolean(args.pinned),
        tags: readStringArray(args.tags),
        source: readString(args.source) || "mcp",
        sourceMessageIds: []
      });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "memory_create failed");
    }
    return textToolResult({ data: memory });
  }

  if (name === "memory_list") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const limit = readPositiveInt(args.limit, 100, 1000);
    const namespace = resolveNamespace(profile, args.namespace);

    // v2: 走 D1 (本体)，能列出 fact_key upsert 写入的记录。
    // v1: 走 Vectorize (向量是当时唯一存储)。
    if (isV2Enabled(env)) {
      const page = await listMemoriesPage(env.DB, {
        namespace,
        type: readString(args.type),
        status: readString(args.status) ?? "active",
        limit,
        offset: readNonNegativeInt(args.offset ?? 0, 0, 1000000)
      });
      const lifecycleRows = await fetchMemoryLifecycleRows(env.DB, page.records.map((r) => r.id));
      const lifecycleByMemoryId = new Map(lifecycleRows.map((lc) => [lc.memory_id, lc]));
      return textToolResult({
        data: page.records.map((r) => toMemoryApiRecord(r, undefined, lifecycleByMemoryId.get(r.id) ?? null)),
        paging: {
          limit,
          has_more: page.hasMore,
          next_offset: page.nextOffset
        }
      });
    }

    try {
      const page = await listVectorMemories(env, {
        namespace,
        count: limit,
        cursor: readString(args.cursor),
        type: readString(args.type) ?? undefined,
        status: readString(args.status) ?? undefined
      });
      return textToolResult({
        data: page.data,
        ...(readBoolean(args.include_ids) ? { ids: page.ids } : {}),
        paging: {
          limit,
          cursor: page.cursor,
          has_more: page.hasMore,
          count: page.count,
          total_count: page.totalCount
        }
      });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : `${requested} failed`);
    }
  }

  if (name === "memory_export") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    if (!hasScope(profile, "export:read")) return toolError("Missing export:read scope");
    try {
      const result = await exportMemories(env, {
        namespace: resolveNamespace(profile, args.namespace),
        type: readString(args.type),
        format: readString(args.format) || "json"
      });
      return textToolResult(result);
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "memory_export failed");
    }
  }

  if (name === "memory_get") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const id = readString(args.id);
    if (!id) return toolError("id is required");

    // v2: 走 D1，能拿到 fact_key upsert / supersede 写入的记录。
    if (isV2Enabled(env)) {
      const record = await getMemoryById(env.DB, {
        namespace: resolveNamespace(profile, args.namespace),
        id
      });
      if (!record) return toolError("Memory not found");
      const lifecycleRows = await fetchMemoryLifecycleRows(env.DB, [record.id]);
      return textToolResult({ data: toMemoryApiRecord(record, undefined, lifecycleRows[0] ?? null) });
    }

    const memory = await getVectorMemory(env, id);
    if (!memory) return toolError("Memory not found");
    return textToolResult({ data: memory });
  }

  if (name === "memory_delete") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const id = readString(args.id);
    if (!id) return toolError("id is required");

    // v2: 硬删 D1 + 向量 (本体和镜像一起删)，找不到返回 false。
    if (isV2Enabled(env)) {
      const deleted = await deleteMemoryV2(env, {
        namespace: resolveNamespace(profile, args.namespace),
        id
      });
      if (!deleted) return toolError("Memory not found");
      return textToolResult({ data: { id, deleted: true } });
    }

    await deleteVectorMemory(env, id);
    return textToolResult({
      data: {
        id,
        deleted: true
      }
    });
  }

  if (name === "memory_ingest") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const messages = readMessages(args.messages);
    if (messages.length === 0) return toolError("messages must contain at least one message");
    const namespace = resolveNamespace(profile, args.namespace);
    const conversation = await getOrCreateConversation(env.DB, {
      namespace,
      id: readString(args.conversation_id)
    });
    const source = readString(args.source) || "mcp";
    const ids = await saveIngestMessages(env.DB, {
      conversationId: conversation.id,
      namespace,
      source,
      messages
    });

    return textToolResult({
      data: {
        conversation_id: conversation.id,
        message_ids: ids,
        auto_extract: args.auto_extract !== false
      }
    });
  }



  // --- Aelios 记忆库 v2 端点 (母帖 #11 第 2 步) ---
  // 全部走 MEMORY_LIFECYCLE_ENABLED 总闸；关时返回未启用，不碰 v2 表。

  if (name === "memory_boot") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    if (!isV2Enabled(env)) return toolError("memory_boot requires MEMORY_LIFECYCLE_ENABLED=true");
    const bootNamespace = resolveNamespace(profile, args.namespace);
    const pkg = await buildBootPackage(env, {
      namespace: bootNamespace
    });
    // Injection accounting moved out of buildBootPackage; schedule off response path.
    if (pkg.precious.length > 0) {
      ctx.waitUntil(
        markPreciousInjected(env.DB, {
          namespace: bootNamespace,
          ids: pkg.precious.map((p) => p.id)
        })
      );
    }
    return textToolResult({ data: pkg });
  }

  if (name === "memory_recall") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    if (!isV2Enabled(env)) return toolError(`${requested} requires MEMORY_LIFECYCLE_ENABLED=true`);
    const query = readString(args.query);
    if (!query) return toolError("query is required");
    const result = await runRecall(env, {
      namespace: resolveNamespace(profile, args.namespace),
      query,
      k: readNumber(args.k, 20),
      min_score: typeof args.min_score === "number" ? readNumber(args.min_score, 0.15) : undefined,
      types: readStringArray(args.types),
      include_history: readBoolean(args.include_history, false)
    });
    return textToolResult({ data: result });
  }

  if (name === "memory_pin") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError(`${requested} requires MEMORY_LIFECYCLE_ENABLED=true`);
    const content = readString(args.content);
    if (!content) return toolError("content is required");
    const precious = await createPrecious(env.DB, {
      namespace: resolveNamespace(profile, args.namespace),
      content,
      contextMessageIds: readStringArray(args.context_message_ids)
    });
    return textToolResult({ data: precious });
  }

  if (name === "glossary_set") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError(`${requested} requires MEMORY_LIFECYCLE_ENABLED=true`);
    const term = readString(args.term);
    const definition = readString(args.definition);
    if (!term) return toolError("term is required");
    if (!definition) return toolError("definition is required");
    const row = await upsertGlossary(env.DB, {
      namespace: resolveNamespace(profile, args.namespace),
      term,
      aliases: readStringArray(args.aliases),
      definition,
      examples: readStringArray(args.examples)
    });
    return textToolResult({ data: row });
  }

  if (name === "memory_upsert") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("memory_upsert requires MEMORY_LIFECYCLE_ENABLED=true");
    const factKey = readString(args.fact_key);
    const content = readString(args.content);
    if (!factKey) return toolError("fact_key is required");
    if (!content) return toolError("content is required");
    try {
      const result = await upsertMemoryByFactKey(env, {
        namespace: resolveNamespace(profile, args.namespace),
        factKey,
        content,
        type: readString(args.type) || "fact",
        importance: readNumber(args.importance, 0.6),
        confidence: readNumber(args.confidence, 0.8),
        tags: readStringArray(args.tags),
        source: readString(args.source) || "mcp",
        validAsOf: readString(args.valid_as_of),
        authoredBy: readString(args.authored_by) || null,
        responseTendency: readString(args.response_tendency) || null
      });
      return textToolResult({ data: result });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "memory_upsert failed");
    }
  }

  if (name === "memory_supersede") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("memory_supersede requires MEMORY_LIFECYCLE_ENABLED=true");
    const oldId = readString(args.old_id);
    const newContent = readString(args.new_content);
    if (!oldId) return toolError("old_id is required");
    if (!newContent) return toolError("new_content is required");
    try {
      const result = await supersedeMemory(env, {
        namespace: resolveNamespace(profile, args.namespace),
        oldId,
        newContent,
        newType: readString(args.new_type) || "world_fact",
        newFactKey: readString(args.new_fact_key),
        validAsOf: readString(args.valid_as_of),
        reason: readString(args.reason),
        // MCP 走的是亲手通道：source 记 "mcp"，E 轴字段随之生效 (也能亲手 supersede 亲笔记忆)。
        source: "mcp",
        authoredBy: readString(args.authored_by) || null,
        responseTendency: readString(args.response_tendency) || null
      });
      return textToolResult({ data: result });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "memory_supersede failed");
    }
  }

  if (name === "memory_archive") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("memory_archive requires MEMORY_LIFECYCLE_ENABLED=true");
    const id = readString(args.id);
    if (!id) return toolError("id is required");
    const archived = await archiveMemory(env, {
      namespace: resolveNamespace(profile, args.namespace),
      id
    });
    if (!archived) return toolError("Memory not found");
    return textToolResult({ data: { id, archived: true } });
  }

  if (name === "digest_get" || name === "digest_set") {
    return toolError(
      `${params.name} is deprecated in v3; digest lives in the client system prompt. Use read_diary for daily_log.`
    );
  }

  if (name === "memory_extract_dryrun") {
    return toolError(
      "memory_extract_dryrun is deprecated in v3; extraction runs via the dream nightly pipeline. Use dream dry_run endpoints instead."
    );
  }

  // 候选审核：clef 自动审关着时，助手自己用这两个工具审。决定记成 judge[助手名]，审核页能撤回。
  if (name === "memory_candidates") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const namespace = resolveNamespace(profile, args.namespace);
    const limit = readPositiveInt(args.limit, 20, 50);
    // zone_full 是区满了被挡下的，这里批不了，不列。
    const pending = (await listMemoryCandidates(env.DB, { namespace, status: "pending", limit: 200 }))
      .filter((candidate) => candidate.source !== "zone_full");
    const speakers = await loadSpeakersForNamespace(env, namespace);
    const data = [];
    for (const candidate of pending.slice(0, limit)) {
      const ids = parseJsonArray(candidate.source_message_ids);
      const messages = ids.length > 0 ? await getMessagesByIds(env.DB, { namespace, ids }) : [];
      data.push({
        id: candidate.id,
        action: judgeKindFor(candidate.source),
        type: candidate.type,
        content: candidate.content,
        fact_key: candidate.fact_key,
        old_memory: await loadOldMemoryForCandidate(env, namespace, candidate),
        transcript: messages.length > 0 ? formatSpeakerTranscript(messages, speakers, 600) : null,
        created_at: candidate.created_at
      });
    }
    return textToolResult({ data, pending: pending.length });
  }

  if (name === "memory_review") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const namespace = resolveNamespace(profile, args.namespace);
    const id = readString(args.id);
    const decision = readString(args.decision);
    if (!id) return toolError("id is required");
    if (decision !== "approve" && decision !== "discard") return toolError("decision must be approve or discard");
    const candidate = await getMemoryCandidateById(env.DB, { namespace, id });
    if (!candidate) return toolError("Candidate not found");
    if (candidate.status !== "pending") return toolError(`Candidate was already decided (${candidate.status})`);
    if (decision === "approve" && candidate.source === "zone_full") {
      return toolError("This candidate is held back because its memory zone is full; leave it for the person");
    }
    const speakers = await loadSpeakersForNamespace(env, namespace);
    const reviewer = (speakers?.assistantName ?? "").replace(/[\]\r\n]/g, "").trim().slice(0, 32) || "助手";
    const reason = (readString(args.reason) ?? "").replace(/\s+/g, " ").trim().slice(0, 300)
      || (decision === "approve" ? "我决定记住。" : "我决定放下。");
    const decisionNote = `${judgeNotePrefix(reviewer)}${reason}`;
    try {
      if (decision === "discard") {
        await updateMemoryCandidateStatus(env.DB, { namespace, id, status: "discarded", decisionNote });
        return textToolResult({ data: { id, status: "discarded", memory_id: null } });
      }
      const memoryId = await approveCandidate(
        env,
        namespace,
        candidate,
        parseJsonArray(candidate.tags),
        parseJsonArray(candidate.source_message_ids)
      );
      await updateMemoryCandidateStatus(env.DB, { namespace, id, status: "approved", targetMemoryId: memoryId, decisionNote });
      return textToolResult({ data: { id, status: "approved", memory_id: memoryId } });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "memory_review failed");
    }
  }

  if (name === "diary_get") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const namespace = resolveNamespace(profile, args.namespace);
    const timeZone = readDreamTimeZoneFromEnv(env);
    const week = readString(args.week);
    if (week && !/^\d{4}-W\d{2}$/.test(week)) {
      return toolError("week must be YYYY-Www (ISO week label)");
    }
    if (week) {
      const row = await getWeeklyLog(env.DB, { namespace, week });
      if (!row) return textToolResult({ data: null });
      return textToolResult({ data: withImpressionDisclaimer({ ...row }) });
    }
    const date = readString(args.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return toolError("date must be YYYY-MM-DD");
    }
    if (date) {
      const row = await getDailyLog(env.DB, { namespace, date });
      if (row) return textToolResult({ data: withImpressionDisclaimer({ ...row }) });
      const weekLabel = getIsoWeekLabelForDateLabel(date, timeZone);
      const weekly = await getWeeklyLog(env.DB, { namespace, week: weekLabel });
      if (!weekly) return textToolResult({ data: null });
      return textToolResult({ data: withImpressionDisclaimer({ ...weekly, note: "daily rolled into weekly" }) });
    }
    const today = formatDateLabel(new Date(), timeZone);
    const yesterday = getYesterdayDateLabel(timeZone);
    const rows = await Promise.all([
      getDailyLog(env.DB, { namespace, date: today }),
      getDailyLog(env.DB, { namespace, date: yesterday })
    ]);
    return textToolResult({
      data: rows.filter((row) => row !== null).map((row) => withImpressionDisclaimer({ ...row }))
    });
  }

  return toolError(`Unknown tool: ${String(params.name || "")}`);
}

async function handleRpc(
  request: JsonRpcRequest,
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  listOptions: ToolListOptions
): Promise<Record<string, unknown> | null> {
  if (!request.id && request.method?.startsWith("notifications/")) return null;

  if (request.method === "initialize") {
    return rpcResult(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "companion-memory-mcp", version: "0.1.0" },
      instructions: MEMORY_GUIDE
    });
  }

  if (request.method === "tools/list") {
    return rpcResult(request.id, { tools: getTools(listOptions) });
  }

  if (request.method === "resources/list") {
    return rpcResult(request.id, { resources: [] });
  }

  if (request.method === "prompts/list") {
    return rpcResult(request.id, { prompts: [] });
  }

  if (request.method === "tools/call") {
    const params = isRecord(request.params) ? (request.params as ToolCallParams) : {};
    const result = await callTool(env, ctx, profile, params);
    return rpcResult(request.id, result);
  }

  if (request.method === "ping") {
    return rpcResult(request.id, {});
  }

  return rpcError(request.id, -32601, "Method not found");
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET") {
    return json({
      name: "companion-memory-mcp",
      transport: "streamable-http",
      endpoint: new URL(request.url).pathname,
      tools: getTools(toolListOptions(env, new URL(request.url))).map((tool) => tool.name)
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await authenticate(withTokenQuery(request), env);
  if (!auth.ok) return rpcErrorResponse(null, -32001, "Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcErrorResponse(null, -32700, "Parse error", 400);
  }

  const listOptions = toolListOptions(env, new URL(request.url));

  if (Array.isArray(body)) {
    const results = (
      await Promise.all(
        body
          .filter((item): item is JsonRpcRequest => isRecord(item))
          .map((item) => handleRpc(item, env, ctx, auth.profile, listOptions))
      )
    ).filter((item): item is Record<string, unknown> => item !== null);
    return results.length > 0 ? json(results) : new Response(null, { status: 202 });
  }

  if (!isRecord(body)) return rpcErrorResponse(null, -32600, "Invalid Request", 400);

  const result = await handleRpc(body, env, ctx, auth.profile, listOptions);
  return result ? json(result) : new Response(null, { status: 202 });
}

function rpcErrorResponse(id: JsonRpcId | undefined, code: number, message: string, status: number): Response {
  return json(rpcError(id, code, message), { status });
}
