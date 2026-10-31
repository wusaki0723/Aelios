import { authenticate } from "../auth/apiKey";
import { markMemoriesInjected, listPrecious } from "../db/v2";
import { recallInjectionBudget } from "../memory/filter";
import { isEvidenceQuery, isPreciousRelevant, isTemporalQuery, selectRelevantPrecious, shapeRecallQuery } from "../memory/queryShape";
import { selectRecall } from "../memory/recallSelector";
import { searchQuotes } from "../memory/quotes";
import { assembleRecallSurface, type SurfaceEntry } from "../memory/surface";
import { buildCoreFingerprint, runRecall } from "../memory/v2/recall";
import type { Env } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";
import { cleanMessageText } from "../utils/sanitize";
import { codingClient, codingSpeech, recallWords, stripCodeBlocks } from "./coding";
import { findIdentity, identityNamespace, identityReadNamespaces, isMainModel, loadConfig, type GatewayConfig, type Identity, type Protocol } from "./config";
import { appendMemory, classifyTurn, hasServerState, inputItems, recentHumanTexts, validateBody, visibleText, type Body, type Turn } from "./protocol";
import { RequestContractError } from "./request";
import { dispatchExchange, persistExchange, persistHumanUtterance, observeResponse, prepareExchange, settleExchange, type GatewayExchange, type OutputCollector } from "./record";
import { callGatewayUpstream, prepareGatewayRequest, UpstreamRouteError, type PreparedRequest } from "./upstream";

export function gatewayError(protocol: Protocol, message: string, status: number): Response {
  const type = status === 401 ? "authentication_error" : status >= 500 ? "api_error" : "invalid_request_error";
  return Response.json(protocol === "messages" ? { type: "error", error: { type, message } } : { error: { type, message } }, { status });
}

function memoryKind(source: string | null | undefined, type: string, authoredBy?: string | null): string {
  if (source === "remember_now" || authoredBy) return "authored";
  if (source === "dream" || source === "judge" || source === "extract") return "distilled";
  return type;
}

export async function recallPatch(
  env: Env,
  identity: Identity,
  rawQuery: string,
  ctx: ExecutionContext,
  rawRecent: string[] = [],
  options: { excludeMessageIds?: string[]; recallId?: string; excludeVisibleIn?: string } = {}
): Promise<string> {
  const namespace = identityNamespace(identity);
  const namespaces = identityReadNamespaces(identity);
  const recallId = options.recallId ?? newId("rcl");
  const query = cleanMessageText(rawQuery);
  const recent = rawRecent.map((text) => cleanMessageText(text)).filter(Boolean);
  if (!query) {
    console.log("gateway recall decision", { recall_id: recallId, identity: identity.slug, injected: 0,
      reason: "no_user_speech" });
    return "";
  }
  const shaped = shapeRecallQuery({ query, recent });
  const budget = recallInjectionBudget(env);
  const evidence = isEvidenceQuery(query);
  const temporal = isTemporalQuery(query);
  if (budget.maxItems === 0 || namespaces.length === 0) {
    console.log("gateway recall decision", { recall_id: recallId, identity: identity.slug, injected: 0,
      reason: namespaces.length ? "budget_zero" : "no_read_spaces" });
    return "";
  }

  const spaces = await Promise.allSettled(namespaces.map(async (namespace) => {
    const precious = await listPrecious(env.DB, { namespace, limit: 80 });
    const relevantPrecious = selectRelevantPrecious(precious, shaped.lexicalTokens);
    const [recall, quotes] = await Promise.all([
      runRecall({ ...env, ENABLE_MEMORY_RERANKER: "false" }, {
        namespace,
        query,
        recent,
        k: 12,
        core_fingerprint: buildCoreFingerprint([]),
        skip_inject_mark: true,
        grounded: false,
        attach_week_blocks: temporal,
        waitUntil: promise => ctx.waitUntil(promise.catch(() => console.error("gateway recall accounting failed")))
      }),
      evidence
        ? searchQuotes(env.DB, {
            namespace,
            query,
            tokens: shaped.lexicalTokens,
            limit: 4,
            excludeIds: options.excludeMessageIds,
            excludeVisibleIn: options.excludeVisibleIn
          })
        : Promise.resolve([])
    ]);

    const weekBlocks = temporal
      ? recall.week_blocks.filter((block) =>
        isPreciousRelevant(`${block.week} ${block.title} ${block.summary}`, shaped.lexicalTokens)
      )
      : [];

    const regularHits = recall.hits;
    const quoteEntries = quotes.map(hit => ({
      kind: "quote", content: hit.content, id: hit.id, sourceIds: hit.source_ids,
      speaker: hit.role, recordedDate: hit.created_at
    }));
    const droppedPrecious = precious
      .filter((row) => !relevantPrecious.some((kept) => kept.id === row.id))
      .slice(0, 12);
    const entries: SurfaceEntry[] = [
      ...quoteEntries,
      ...relevantPrecious.map(p => ({ kind: "precious", content: p.content, id: p.id, recordedDate: p.created_at })),
      ...recall.glossary_hits.map(p => ({ kind: "glossary", id: `glossary:${p.term}`, content: `${p.term}: ${p.definition}` })),
      ...regularHits.map(p => ({
        kind: memoryKind(p.source, p.type, p.authored_by), content: p.content, id: p.id,
        sourceIds: p.source_message_ids, factKey: p.fact_key,
        recordedDate: p.recorded_date, eventDate: p.event_date
      })),
      ...weekBlocks.map(p => ({ kind: "impression", id: `week:${p.week}`, content: `${p.week}: ${p.summary}` }))
    ].map(entry => ({ ...entry, namespace }));
    return { namespace, entries, relevantPrecious, quotes, regularHits, weekBlocks, droppedPrecious };
  }));
  const available = spaces.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failedNamespaces = namespaces.filter((_, i) => spaces[i].status === "rejected");
  if (!available.length) throw new Error("All configured recall spaces are unavailable");
  // Round-robin both sources and spaces before ONE global decision and budget.
  const entries: SurfaceEntry[] = [];
  const ordinary = new Set(["precious", "glossary", "quote", "impression"]);
  const categories = evidence ? ["regular", "quote", "precious", "glossary", "impression"]
    : ["regular", "precious", "glossary", "impression"];
  const lists = categories.flatMap(kind => available.map(space => space.entries.filter(entry =>
    kind === "regular" ? !ordinary.has(entry.kind) : entry.kind === kind)));
  for (let i = 0; i < Math.max(0, ...lists.map(list => list.length)); i++) {
    for (const list of lists) if (list[i]) entries.push(list[i]);
  }
  const selection = await selectRecall(env, {
    query, recent, visible: options.excludeVisibleIn, entries, maxItems: budget.maxItems
  });
  const assembled = assembleRecallSurface(selection.entries, {
    budget: identity.maxMemoryChars || 6000,
    maxItems: budget.maxItems,
    maxChars: budget.maxChars
  });

  for (const namespace of namespaces) {
    const injectedMemoryIds = assembled.entries
      .filter(entry => entry.namespace === namespace)
      .filter((entry) => entry.id && entry.kind !== "precious" && entry.kind !== "glossary" && entry.kind !== "week" && entry.kind !== "quote" && entry.kind !== "impression")
      .map((entry) => entry.id!);
    if (injectedMemoryIds.length > 0) {
      ctx.waitUntil(
        markMemoriesInjected(env.DB, { namespace, ids: injectedMemoryIds })
          .catch(() => console.error("gateway recall accounting failed"))
      );
    }
  }

  const explain = {
    recall_id: recallId,
    identity: identity.slug,
    write_namespace: namespace,
    read_namespaces: namespaces,
    failed_namespaces: failedNamespaces,
    query: query.slice(0, 80),
    tokens: shaped.lexicalTokens.slice(0, 12),
    thin: shaped.thin,
    evidence,
    channels: {
      precious_selected: available.reduce((n, s) => n + s.relevantPrecious.length, 0),
      quotes: available.reduce((n, s) => n + s.quotes.length, 0),
      regular_hits: available.reduce((n, s) => n + s.regularHits.length, 0),
      week_blocks: available.reduce((n, s) => n + s.weekBlocks.length, 0),
      candidates: entries.length
    },
    selection: { status: selection.status, model: selection.model, reason: selection.reason,
      threshold: selection.threshold, elapsed_ms: selection.elapsedMs },
    decisions: selection.decisions.map(decision => ({ ...decision,
      injected: assembled.entries.some(entry => entry.id === decision.id && entry.namespace === decision.namespace && entry.kind === decision.kind)
    })),
    items: assembled.entries.map((entry) => ({
      id: entry.id ?? null,
      source_ids: entry.sourceIds,
      namespace: entry.namespace,
      kind: entry.kind,
      reason: entry.kind === "quote"
        ? "quote_excerpt"
        : entry.kind === "precious"
          ? "precious_lexical"
          : entry.kind === "authored"
            ? "authored_verbatim"
            : entry.exact
              ? "exact_window"
              : "recall_hit",
      window: entry.window ?? null,
      purpose: entry.purpose ?? null
    })),
    excluded: [
      ...available.flatMap(s => s.droppedPrecious.map(row => ({ id: row.id, namespace: s.namespace, reason: "precious_not_relevant" })))
    ].slice(0, 24),
    injected: assembled.entries.length,
    kinds: assembled.entries.map((entry) => entry.kind),
    budget: { maxItems: budget.maxItems, maxChars: budget.maxChars }
  };
  console.log("gateway recall decision", explain);
  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO memory_events (id, namespace, event_type, memory_id, payload_json, created_at)
       VALUES (?, ?, 'recall_explain', NULL, ?, ?)`
    ).bind(recallId, namespace, JSON.stringify(explain), nowIso())
      .run()
      .catch(() => console.error("gateway recall explain persist failed"))
  );
  return assembled.text;
}
/**
 * A coding step that only worked on code leaves nothing to keep. Finished, it adds no rows and only
 * closes an earlier failed try of the same request; failed or cut off, it is written at once instead
 * of queued, so that a quick retry finds the row to close.
 */
export async function recordExchange(env: Env, exchange: GatewayExchange, coding: boolean): Promise<void> {
  if (coding && exchange.kind !== "human" && !cleanMessageText(exchange.assistantText)) {
    if (exchange.completion === "complete") await settleExchange(env, exchange);
    else await persistExchange(env, exchange);
    return;
  }
  await dispatchExchange(env, exchange);
}

export interface RecallOutcome { memory: string; patch: string; remember: string }

/**
 * A main-model turn that a person said: optionally keep their words at once, then recall for them.
 * The gateway always persists; POST /v1/hook/recall requires the caller's recording consent.
 * `memory` and `remember` use the values of the x-aelios-memory and x-aelios-remember headers.
 */
export async function rememberAndRecall(env: Env, ctx: ExecutionContext, identity: Identity, protocol: Protocol,
  body: Body, turn: Turn, exchange: GatewayExchange | null, coding: string | null, recallId: string,
  persistHuman = true): Promise<RecallOutcome> {
  let patch = "";
  let memory = turn.kind !== "human" ? "skipped" : "empty";
  let remember = "none";
  if (persistHuman && exchange && turn.kind === "human" && turn.text) {
    try {
      const captured = await persistHumanUtterance(env, exchange);
      if (captured.remember.wrote) remember = captured.remember.indexed ? "indexed" : "saved";
    } catch (error) {
      remember = "failed";
      console.error("gateway human utterance persist failed", { identity: identity.slug, error });
    }
  }
  if (turn.kind === "human" && turn.text) {
    try {
      // A coding agent's code is not words to search memories with, in this turn or the ones before.
      const prior = recentHumanTexts(body, protocol).slice(0, -1).slice(-3)
        .map(text => coding ? recallWords(text) : text).filter(Boolean);
      patch = await recallPatch(env, identity, coding ? recallWords(turn.text) : turn.text, ctx, prior, {
        excludeMessageIds: exchange ? [exchange.userId] : [],
        recallId,
        // A quote still present in this request's history is visible; recalling it
        // would spend budget without adding information.
        excludeVisibleIn: inputItems(body, protocol).slice(0, -1).map(item => cleanMessageText(visibleText(item.content))).join("\n")
      });
      memory = patch ? "injected" : "empty";
    }
    catch (error) {
      memory = "unavailable";
      console.error("gateway recall unavailable", { identity: identity.slug, error });
    }
  }
  return { memory, patch, remember };
}

/** What the reply said and how it ended, onto the exchange, as the gateway records it. */
export function settleOutput(exchange: GatewayExchange, out: OutputCollector, coding: boolean, ok: boolean,
  interrupted: boolean): void {
  const said = coding ? codingSpeech(out) : out;
  exchange.assistantText = said.text;
  if (out.model) exchange.model = out.model;
  exchange.completion = !ok || out.failed ? "failed" :
    said.truncated || exchange.completion === "truncated" ? "truncated" :
    interrupted || !out.complete ? "incomplete" : "complete";
}

export async function handleGateway(request: Request, env: Env, ctx: ExecutionContext,
  protocol: Protocol, slug: string | null = null): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return gatewayError(protocol, "Unauthorized", 401);
  let body: Body;
  try { body = await request.json(); validateBody(body, protocol); }
  catch (error) { return gatewayError(protocol, error instanceof Error ? error.message : "Invalid JSON", 400); }
  let config: GatewayConfig;
  try { config = await loadConfig(env); }
  catch { return gatewayError(protocol, "Gateway configuration unavailable. Apply migrations and check /admin.", 503); }
  const identity = findIdentity(config, auth, slug);
  if (!identity) {
    return gatewayError(protocol, slug
      ? `No identity "${slug}" available for this key. Configure /admin, then use https://<host>/<identity>/v1.`
      : "This key has no identity. Configure one at /admin.", 403);
  }
  // Only main models carry memory and feed Dream; every other model passes through quietly.
  const main = isMainModel(identity, body.model);
  if (protocol === "responses" && main && hasServerState(body, protocol)) {
    return gatewayError(protocol, "Request-only memory requires stateless Responses input: send full history without previous_response_id, conversation or item_reference; or use a model outside the main list.", 400);
  }
  // Coding agents keep memory of what was said, not of the code (see coding.ts).
  const coding = main && identity.codingFilter !== false ? codingClient(request.headers, body) : null;
  const classified = classifyTurn(body, protocol, request.headers.get("x-aelios-purpose") === "auxiliary");
  const turn = coding && classified.text ? { ...classified, text: stripCodeBlocks(classified.text) } : classified;
  let prepared: PreparedRequest;
  try { prepared = prepareGatewayRequest(env, config, identity, protocol, request, body); }
  catch (error) {
    return gatewayError(protocol, error instanceof Error ? error.message : "Invalid upstream request",
      error instanceof RequestContractError || error instanceof UpstreamRouteError ? 400 : 502);
  }
  if (prepared.removed.length) console.log("gateway request normalized", { protocol, removed: prepared.removed });
  const recallId = newId("rcl");
  const exchange = main ? await prepareExchange(request, body, identity, protocol, turn, auth.profile.source) : null;
  const { memory: memoryStatus, patch, remember: rememberStatus } = main
    ? await rememberAndRecall(env, ctx, identity, protocol, body, turn, exchange, coding, recallId)
    : { memory: "off", patch: "", remember: "none" };
  const payload = appendMemory(prepared.body, protocol, patch);
  if (protocol === "responses" && main) payload.store = false;
  try {
    const upstream = await callGatewayUpstream(env, protocol, request, prepared, payload, ctx);
    const headers = new Headers(upstream.headers);
    headers.set("x-aelios-identity", identity.slug);
    headers.set("x-aelios-memory", memoryStatus);
    headers.set("x-aelios-normalized", String(prepared.removed.length));
    headers.set("x-aelios-recall-id", recallId);
    headers.set("x-aelios-remember", rememberStatus);
    headers.set("x-aelios-provider", upstream.headers.get("cf-aig-provider") || "");
    headers.set("x-aelios-model", upstream.headers.get("cf-aig-model") || body.model);
    if (coding) headers.set("x-aelios-coding", coding);
    headers.set("cache-control", "no-store");
    const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
    if (!exchange) return response;
    exchange.httpStatus = upstream.status;
    exchange.model = headers.get("x-aelios-model")!;
    exchange.provider = headers.get("x-aelios-provider")!;
    if (!response.body) {
      exchange.completion = "failed";
      ctx.waitUntil(recordExchange(env, exchange, Boolean(coding)).catch(() => console.error("gateway exchange recording failed")));
      return response;
    }
    return observeResponse(response, protocol, ctx, async (out, interrupted) => {
      settleOutput(exchange, out, Boolean(coding), upstream.ok, interrupted);
      await recordExchange(env, exchange, Boolean(coding));
    }, Boolean(coding));
  } catch (error) {
    console.error("gateway upstream error", error);
    if (exchange) {
      exchange.completion = "failed";
      exchange.httpStatus = 502;
      ctx.waitUntil(recordExchange(env, exchange, Boolean(coding)).catch(() => console.error("gateway exchange recording failed")));
    }
    return gatewayError(protocol, `Upstream request failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof UpstreamRouteError || error instanceof RequestContractError ? error.status : 502);
  }
}
