import { authenticate } from "../auth/apiKey";
import { getOrCreateConversation } from "../db/conversations";
import { fetchMemoriesByIds, getMemoryById, listMemoriesPage } from "../db/memories";
import { getMessagesByIds, saveIngestMessages } from "../db/messages";
import {
  archiveMemory,
  createPrecious,
  deleteMemoryV2,
  fetchMemoryLifecycleRows,
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
  description: "Memory id (e.g. from memory_search, memory_recall or memory_list)."
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

// Reads that also write recall bookkeeping (counters / last-injected timestamps), never memory content.
const BOOKKEEPING_READ = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function getTools(): Array<Record<string, unknown>> {
  return [
    {
      name: "memory_search",
      description:
        "Hybrid search (vector + keyword) over the user's active long-term memories. Returns up to top_k full records " +
        "(id, content, type, status, scores) after a relevance filter but without reranking, as { data: [...] }. " +
        "Use it to find memories you want to inspect or edit by id. To answer a question with the most relevant, " +
        "reranked memories plus glossary hits, use memory_recall instead. Never changes memory content; " +
        "it only updates recall counters.",
      annotations: { title: "Search memories", ...BOOKKEEPING_READ },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for, in natural language or keywords." },
          top_k: {
            type: "number",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of records to return. Defaults to the server setting (50)."
          },
          types: {
            type: "array",
            items: { type: "string" },
            description: `Only return these memory types (${MEMORY_TYPES_TEXT}). Omit for all types.`
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["query"]
      }
    },
    {
      name: "memory_list",
      description:
        "Page through stored memories without a query, pinned first, then by importance, then most recently updated; " +
        "optionally filtered by type or status. Returns { data, paging: { limit, has_more, next_offset } }; pass next_offset back as offset for the next page. " +
        "Use memory_search or memory_recall to find memories by meaning. Read-only.",
      annotations: { title: "List memories", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 1000, description: "Page size. Defaults to 100." },
          offset: { type: "number", minimum: 0, description: "Number of records to skip. Use paging.next_offset from the previous page." },
          cursor: { type: "string", description: "Legacy paging cursor; only used when the lifecycle store is disabled. Prefer offset." },
          include_ids: { type: "boolean", description: "Legacy mode only: also return the bare id list." },
          type: { type: "string", description: `Only list one memory type (${MEMORY_TYPES_TEXT}).` },
          status: {
            type: "string",
            description: "Only list memories with this status: active (default), archived or superseded."
          },
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "memory_export",
      description:
        "Export the namespace's active memories (content plus metadata) as one JSON payload, for backup or " +
        "migration. Archived and superseded memories are not included. The result can be large; use memory_list to page or memory_search to look things up. Read-only.",
      annotations: { title: "Export memories", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: `Only export one memory type (${MEMORY_TYPES_TEXT}). Omit for all.` },
          format: { type: "string", enum: ["json"], description: "Output format. Only json is supported (default)." },
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "memory_get",
      description:
        "Fetch one memory by id with its full record and lifecycle fields (fact_key, version status, superseded_by). " +
        "Returns { data: record }, or an error result 'Memory not found' if the id does not exist in this namespace. Use it after " +
        "memory_search, memory_recall or memory_list when you need the complete record before editing. Read-only.",
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
      name: "memory_delete",
      description:
        "Permanently delete one memory by id, removing it from storage and from the search index. This cannot be " +
        "undone. To hide a memory but keep the record, use memory_archive; to replace an outdated fact while keeping " +
        "its history, use memory_supersede. Returns { data: { id, deleted: true } }, or an error result if the id is not " +
        "found or the memory could not be removed from the search index (the record is then kept).",
      annotations: {
        title: "Delete memory",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
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
      name: "memory_ingest",
      description:
        "Store raw chat messages as conversation history. Memories are not extracted immediately: the nightly " +
        "background pipeline (dream) reads stored messages and distills them into long-term memories later. " +
        "To save a fact right away, use memory_upsert. Returns { data: { conversation_id, message_ids } }; message_ids " +
        "can be passed to memory_pin as context.",
      annotations: {
        title: "Ingest messages",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            description: "Messages in chronological order.",
            items: {
              type: "object",
              properties: {
                role: { type: "string", description: "One of user, assistant, system, tool. Other roles are dropped." },
                content: { description: "Message text, or an OpenAI-style content parts array." }
              },
              required: ["role", "content"]
            }
          },
          conversation_id: {
            type: "string",
            description: "Conversation to append to. Defaults to the namespace's shared default conversation."
          },
          source: { type: "string", description: "Label for where the messages came from. Defaults to 'mcp'." },
          auto_extract: {
            type: "boolean",
            description: "Accepted for compatibility only; it is not stored and does not change processing."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["messages"]
      }
    },
    // --- Aelios 记忆库 v2 端点 (母帖 #11 第 2 步) ---
    // 全部走 MEMORY_LIFECYCLE_ENABLED 总闸；关时返回未启用。
    {
      name: "memory_boot",
      description:
        "Cold-start context package for a new session: yesterday's diary log, the latest weekly and monthly summaries, " +
        "the 20 most recent precious entries (from memory_pin), every glossary term and any spontaneous perception " +
        "items, as { data: {...} }. Output is stable and deterministically ordered so the client can cache it. " +
        "Call once at session start, not every turn; for per-question lookups use memory_recall. Never changes " +
        "memory content; it only records that the returned precious entries were shown.",
      annotations: { title: "Load session context", ...BOOKKEEPING_READ },
      inputSchema: {
        type: "object",
        properties: {
          namespace: NAMESPACE_PARAM
        }
      }
    },
    {
      name: "memory_recall",
      description:
        "Answer-oriented recall: matches glossary terms literally, runs hybrid search over active memories, " +
        "reranks the hits and drops anything below min_score. Returns { data: { hits, glossary_hits, week_blocks, meta } }, " +
        "each hit with id, score and source so you can cite or edit it. Precious entries are not searched here " +
        "(they come from memory_boot). Prefer this over memory_search when you want only the relevant memories " +
        "for the current question. Never changes memory content, but marks the returned memories as recently " +
        "injected, which briefly lowers their rank in later automatic recall.",
      annotations: { title: "Recall memories", ...BOOKKEEPING_READ },
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The question or topic to recall memories for." },
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
            description: "Relevance floor applied after reranking. Defaults to the server setting (0.15)."
          },
          types: {
            type: "array",
            items: { type: "string" },
            description: `Only recall these memory types (${MEMORY_TYPES_TEXT}). Omit for all types.`
          },
          namespace: NAMESPACE_PARAM,
          include_history: {
            type: "boolean",
            description:
              "When true, include superseded memory versions (status/version_status=superseded). Default false."
          }
        },
        required: ["query"]
      }
    },
    {
      name: "memory_pin",
      description:
        "Save a moment as a precious entry: pinned, offered through memory_boot (which shows the 20 most recent), and " +
        "never deduplicated, decayed or deleted by the automatic pipeline. Each call creates a new entry. Write the content so it " +
        "still makes sense on its own later, and attach the surrounding messages via context_message_ids. " +
        "For ordinary facts use memory_upsert. Returns { data: precious record }.",
      annotations: {
        title: "Pin precious memory",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The moment to keep, self-contained and readable on its own." },
          context_message_ids: {
            type: "array",
            items: { type: "string" },
            description: "Ids of stored messages (e.g. message_ids from memory_ingest) to keep as surrounding context."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["content"]
      }
    },
    {
      name: "glossary_set",
      description:
        "Add or update a glossary term: private vocabulary such as nicknames, in-jokes or project names. Terms are " +
        "matched literally (not by vector) during memory_recall and are all included in memory_boot. Upserts by " +
        "term: an existing term gets the new definition, and aliases/examples are replaced by what you pass " +
        "(omitting them clears them). Returns { data: glossary row }.",
      annotations: {
        title: "Set glossary term",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          term: { type: "string", description: "The word or phrase exactly as it is used." },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Other spellings or names that should match this term. Replaces any existing aliases."
          },
          definition: { type: "string", description: "What the term means." },
          examples: {
            type: "array",
            items: { type: "string" },
            description: "Example sentences using the term. Replaces any existing examples."
          },
          namespace: NAMESPACE_PARAM
        },
        required: ["term", "definition"]
      }
    },
    {
      name: "memory_upsert",
      description:
        "Write a refined memory immediately (no waiting for the nightly dream), keyed by fact_key. If an active " +
        "memory with the same fact_key exists, its content and fields are overwritten in place and the old text is " +
        "not kept; otherwise a new memory is created. To keep the old version as history, use memory_supersede. " +
        "Pass authored_by (with the default source) to mark the memory as hand-authored: it ranks above distilled " +
        "memories, and keeps that mark when the nightly pipeline later rewrites it. Returns { data: { id, created } }.",
      annotations: {
        title: "Upsert memory",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          fact_key: {
            type: "string",
            description:
              "Stable key for this fact, e.g. 'user:favorite_coffee'. Reusing a key updates that memory. " +
              "Facts about the outside world rather than the user use the prefix 'world_fact:'."
          },
          content: { type: "string", description: "The memory text, one self-contained statement." },
          type: { type: "string", description: `One of ${MEMORY_TYPES_TEXT}. Other values become fact (default).` },
          importance: { type: "number", description: "0 to 1, how much this matters. Defaults to 0.6." },
          confidence: { type: "number", description: "0 to 1, how sure you are it is true. Defaults to 0.8." },
          tags: { type: "array", items: { type: "string" }, description: "Free-form labels." },
          source: {
            type: "string",
            description:
              "Who is writing. Leave unset (defaults to 'mcp'). authored_by is only stored when source is mcp, manual, api or remember_now."
          },
          valid_as_of: {
            type: "string",
            description: "When the fact became true (ISO date or datetime). Used as the event date in recall."
          },
          authored_by: { type: "string", description: "E-axis signature; only honored on hand sources (mcp/manual/api/remember_now)" },
          response_tendency: { type: "string", description: "E-axis: how to respond when this memory fires" },
          namespace: NAMESPACE_PARAM
        },
        required: ["fact_key", "content"]
      }
    },
    {
      name: "memory_supersede",
      description:
        "Replace an outdated memory while keeping history: marks old_id as superseded (kept, and visible via " +
        "memory_recall with include_history) and inserts a new active memory linked to it. The new entry inherits " +
        "the old fact_key unless new_fact_key is given. If old_id does not exist, the new memory is still created and " +
        "oldStatus is 'missing'. Use it when a fact changed over time; to fix a mistake in place use memory_upsert, " +
        "and to remove a memory use memory_archive or memory_delete. Returns { data: { oldStatus, newId } }.",
      annotations: {
        title: "Supersede memory",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          old_id: { type: "string", description: "Id of the memory being replaced." },
          new_content: { type: "string", description: "The up-to-date memory text." },
          new_type: { type: "string", description: `One of ${MEMORY_TYPES_TEXT}. Other values become fact (default).` },
          new_fact_key: { type: "string", description: "fact_key for the new entry. Defaults to the old entry's fact_key." },
          valid_as_of: { type: "string", description: "When the new fact became true (ISO date or datetime)." },
          reason: { type: "string", description: "Short note on why the old memory is outdated; stored with the chain." },
          authored_by: { type: "string", description: "E-axis signature for the new entry (hand sources only)" },
          response_tendency: { type: "string", description: "E-axis: how to respond when the new memory fires" },
          namespace: NAMESPACE_PARAM
        },
        required: ["old_id", "new_content"]
      }
    },
    {
      name: "memory_archive",
      description:
        "Soft-archive a memory: sets status='archived' and removes it from search and recall, but keeps the record " +
        "in storage (memory_list with status='archived' still shows it). There is no MCP tool to un-archive. " +
        "Does not touch the supersede chain. Prefer this over memory_delete when the memory might be needed later. " +
        "Returns { data: { id, archived: true } }, or an error result 'Memory not found'.",
      annotations: {
        title: "Archive memory",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
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
    },
    {
      name: "diary_get",
      description:
        "Read daily_log diary entries. These are impressions, not verified facts. " +
        "Omit date for today+yesterday (recent). Use week (e.g. 2026-W29) for weekly_log. " +
        "Rolled-up daily dates fall back to weekly_log. Fetch explicitly when needed; do not treat diary as ground truth.",
      annotations: { title: "Read diary", ...READ_ONLY },
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD; omit for recent (today+yesterday)" },
          week: { type: "string", description: "ISO week label, e.g. 2026-W29" },
          namespace: NAMESPACE_PARAM
        }
      }
    }
  ];
}

async function callTool(
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  params: ToolCallParams
): Promise<Record<string, unknown>> {
  const args = isRecord(params.arguments) ? params.arguments : {};

  if (params.name === "memory_search") {
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

  if (params.name === "memory_create") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (isV2Enabled(env)) return toolError("memory_create is deprecated in v2; use memory_upsert with fact_key");
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

  if (params.name === "memory_list") {
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
      return toolError(error instanceof Error ? error.message : "memory_list failed");
    }
  }

  if (params.name === "memory_export") {
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

  if (params.name === "memory_get") {
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

  if (params.name === "memory_delete") {
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

  if (params.name === "memory_ingest") {
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

  if (params.name === "memory_boot") {
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

  if (params.name === "memory_recall") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    if (!isV2Enabled(env)) return toolError("memory_recall requires MEMORY_LIFECYCLE_ENABLED=true");
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

  if (params.name === "memory_pin") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("memory_pin requires MEMORY_LIFECYCLE_ENABLED=true");
    const content = readString(args.content);
    if (!content) return toolError("content is required");
    const precious = await createPrecious(env.DB, {
      namespace: resolveNamespace(profile, args.namespace),
      content,
      contextMessageIds: readStringArray(args.context_message_ids)
    });
    return textToolResult({ data: precious });
  }

  if (params.name === "glossary_set") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    if (!isV2Enabled(env)) return toolError("glossary_set requires MEMORY_LIFECYCLE_ENABLED=true");
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

  if (params.name === "memory_upsert") {
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

  if (params.name === "memory_supersede") {
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

  if (params.name === "memory_archive") {
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

  if (params.name === "digest_get" || params.name === "digest_set") {
    return toolError(
      `${params.name} is deprecated in v3; digest lives in the client system prompt. Use diary_get for daily_log.`
    );
  }

  if (params.name === "memory_extract_dryrun") {
    return toolError(
      "memory_extract_dryrun is deprecated in v3; extraction runs via the dream nightly pipeline. Use dream dry_run endpoints instead."
    );
  }

  // 候选审核：clef 自动审关着时，助手自己用这两个工具审。决定记成 judge[助手名]，审核页能撤回。
  if (params.name === "memory_candidates") {
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

  if (params.name === "memory_review") {
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

  if (params.name === "diary_get") {
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
  profile: KeyProfile
): Promise<Record<string, unknown> | null> {
  if (!request.id && request.method?.startsWith("notifications/")) return null;

  if (request.method === "initialize") {
    return rpcResult(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "companion-memory-mcp", version: "0.1.0" }
    });
  }

  if (request.method === "tools/list") {
    return rpcResult(request.id, { tools: getTools() });
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
      tools: getTools().map((tool) => tool.name)
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

  if (Array.isArray(body)) {
    const results = (
      await Promise.all(
        body
          .filter((item): item is JsonRpcRequest => isRecord(item))
          .map((item) => handleRpc(item, env, ctx, auth.profile))
      )
    ).filter((item): item is Record<string, unknown> => item !== null);
    return results.length > 0 ? json(results) : new Response(null, { status: 202 });
  }

  if (!isRecord(body)) return rpcErrorResponse(null, -32600, "Invalid Request", 400);

  const result = await handleRpc(body, env, ctx, auth.profile);
  return result ? json(result) : new Response(null, { status: 202 });
}

function rpcErrorResponse(id: JsonRpcId | undefined, code: number, message: string, status: number): Response {
  return json(rpcError(id, code, message), { status });
}
