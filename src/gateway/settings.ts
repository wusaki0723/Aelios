import type { Env } from "../types";

// Everything here is editable from /admin, so Worker settings only needs the API key.
export interface SettingSpec { name: string; label: string; hint?: string; group: string }
export const SETTINGS: SettingSpec[] = [
  { group: "记忆召回", name: "MEMORY_LIFECYCLE_ENABLED", label: "记忆库 v2 总闸", hint: "默认开启。填 false 回退旧路径，v2 的 boot 和召回工具会直接回未启用，不碰 v2 表" },
  { group: "记忆召回", name: "RECALL_RERANK_MIN_SCORE", label: "原文重排分数下限", hint: "默认 0.25，低于此值不注入。只是初始值，请结合下方召回记录调整；分数不是正确率，不同模型不可直接比较" },
  { group: "记忆召回", name: "RECALL_RERANK_TIMEOUT_MS", label: "原文重排最多等多久（毫秒）", hint: "默认 1500，上限 5000。超时改走词面 top-1，聊天继续；迟到结果会丢弃，但 CF 调用可能仍会完成并计费" },
  { group: "记忆召回", name: "MEMORY_RERANKER_MODEL", label: "原文重排模型", hint: "默认 @cf/baai/bge-reranker-base，通过 Worker 的 AI 绑定调用。所有来源一次批量打分，不生成记忆正文。失败时回落词面命中，不补调 LLM" },
  { group: "记忆召回", name: "MEMORY_FILTER_MAX_OUTPUT", label: "每次注入几条记忆", hint: "日常建议 1–2 条；显式搜索不受影响。0 表示本轮不注入" },
  { group: "记忆召回", name: "MEMORY_FILTER_MAX_CONTENT_CHARS", label: "显式搜索的重排文本长度", hint: "自动注入使用不超过 400 字的连续原文窗口，不受此项控制；显式搜索返回完整内容和 ID" },
  { group: "记忆召回", name: "MEMORY_TOP_K", label: "先从向量库取多少条", hint: "这是上限不是名额；不够格的不凑数。取回来再交给重排模型挑" },
  { group: "记忆召回", name: "MEMORY_FILTER_MAX_CANDIDATES", label: "每空间普通记忆候选数", hint: "自动召回最终跨来源、跨空间合计最多 16 条候选，每条最多 4 个片段" },
  { group: "记忆召回", name: "MEMORY_MIN_SCORE", label: "相似度下限", hint: "只当垃圾闸。约 0.4 的打平分会再过词面核对，不靠它凑满十条。调太高会漏掉换了说法的记忆" },
  { group: "记忆召回", name: "MEMORY_FILTER_MIN_SCORE", label: "重排前相似度下限" },
  { group: "记忆召回", name: "MEMORY_INJECT_DECAY_FACTOR", label: "刚注入过的记忆降权", hint: "降低近期注入记忆的候选排序；最终原文重排仍按相关性排序。填 1 关闭" },
  { group: "记忆召回", name: "MEMORY_AUTHORED_BOOST", label: "亲笔记忆加成", hint: "自己写的记忆排前面。填 1 关闭" },
  { group: "记忆召回", name: "RECALL_MIN_SCORE", label: "召回地板分", hint: "默认 0.15，打在降权前的原始相关性分上。调高会漏掉换了说法的记忆，调低会放进噪声；显式搜索可用 min_score 临时覆盖" },
  { group: "记忆召回", name: "RELATION_EXPANSION", label: "顺着关系边再扩一跳", hint: "默认 off。填 on 或 true 后，向量种子命中会沿关系边扩 hop1/hop2。关着时召回结果和没这个功能时逐字一致" },
  { group: "记忆召回", name: "TRIGGER_RECALL", label: "触发器联想召回", hint: "默认 off。填 on 或 true 后，问题先查触发器索引，命中的触发器把它挂的记忆并进候选池——专治问题和记忆语义相关但几乎不共享词汇的那一类。关着时召回结果和没这个功能时逐字一致" },
  { group: "记忆召回", name: "TRIGGER_RECALL_GATE", label: "触发器命中门限", hint: "默认 0.85，很高是故意的：这条通道只在几乎可以肯定的时候补一刀。只能往上调，填更低的值按 0.85 处理" },
  { group: "记忆召回", name: "TRIGGER_RECALL_TOP_K", label: "最多采信几条触发器", hint: "默认 10，上限 50。命中的触发器按分排序，只取前几条展开" },
  { group: "记忆召回", name: "ENABLE_MEMORY_FILTER", label: "候选过滤总闸", hint: "默认开启。填 false 后不再过滤、重排、压缩候选，命中原样注入" },
  { group: "记忆召回", name: "ENABLE_MEMORY_RERANKER", label: "原文重排开关", hint: "默认开启。填 false 跳过重排模型，只走词面命中" },
  { group: "记忆召回", name: "MEMORY_FILTER_FAIL_OPEN", label: "过滤链路报错时放行", hint: "默认 false：过滤出错就不注入。填 true 则出错时放行候选，宁可多注入也不丢召回" },
  { group: "记忆召回", name: "RECALL_WEEK_BLOCKS", label: "命中随附周记整块", hint: "默认开启。命中记忆所在那一周的 weekly_log 整块随召回下发。填 false 关掉" },
  { group: "记忆召回", name: "RECALL_WEEK_BLOCK_LIMIT", label: "最多随附几块周记", hint: "默认 2。块是上下文不是命中，不占 k 的名额" },
  { group: "记忆召回", name: "MEMORY_INJECT_DECAY_WINDOW_MIN", label: "刚注入过的记忆降权窗口（分钟）", hint: "默认 30。窗口内注入过的只压排序、不挤出地板；它是唯一相关命中时照样回来" },
  { group: "记忆召回", name: "IMPRESSION_LADDER_MAX_CHARS", label: "Impressions 阶梯字符上限", hint: "默认 1000，boot 里近期印象区的长度预算" },
  { group: "记忆召回", name: "RECALL_REQUIRE_D1_BACKING", label: "丢弃没有 D1 背书的命中", hint: "默认 false 保持现状。填 true 丢掉 Vectorize 里没有对应 D1 记录的孤儿向量，用来清遗留脏数据" },
  { group: "记忆召回", name: "MEMORY_LEGACY_VECTOR_FALLBACK_LIMIT", label: "旧向量兜底条数", hint: "默认 3。老库兜底召回最多取几条" },
  { group: "记忆召回", name: "MEMORY_LEGACY_VECTOR_FALLBACK_SCORE_FACTOR", label: "旧向量兜底折扣", hint: "默认 0.45。乘在旧库命中分上，压低它和新记忆的竞争" },

  { group: "Dream 与日记", name: "ENABLE_DREAM", label: "夜整总闸", hint: "默认开启。填 false 完全不跑 dream。ENABLE_DAILY_MEMORY_DIGEST 是它的旧名，只在没填本项时生效；本项一旦填了就以本项为准" },
  { group: "Dream 与日记", name: "DREAM_MODEL", label: "Dream 用的模型" },
  { group: "Dream 与日记", name: "DREAM_TIME_ZONE", label: "按哪个时区分天", hint: "例如 Asia/Singapore" },
  { group: "Dream 与日记", name: "DREAM_MAX_MESSAGES", label: "一轮读多少条对话" },
  { group: "Dream 与日记", name: "DREAM_MEMORY_CONTEXT_LIMIT", label: "一轮参考多少条已有记忆" },
  { group: "Dream 与日记", name: "DREAM_MAX_RUNS", label: "每天最多跑几轮" },
  { group: "Dream 与日记", name: "DREAM_MAX_TOKENS", label: "单轮输出上限" },
  { group: "Dream 与日记", name: "DEDUP_COSINE", label: "记忆去重相似度", hint: "越高越容易判成新记忆，越低越容易被合并" },
  { group: "Dream 与日记", name: "WEEKLY_ROLLUP_DELETE_DAILIES", label: "周记落成后自动删日志", hint: "填 false 走人工审阅，填 true 一条龙" },
  { group: "Dream 与日记", name: "CANDIDATE_JUDGE_ENABLED", label: "Dream 之后自动审核候选", hint: "默认开启。填 false 才回到全部人工批准" },
  { group: "Dream 与日记", name: "DREAM_STRATEGY", label: "新记忆写入策略", hint: "默认 upsert，直接改写。填 review 改成先进候选队列等人批" },
  { group: "Dream 与日记", name: "DREAM_NAMESPACE", label: "夜整写进哪个记忆空间", hint: "默认 default" },
  { group: "Dream 与日记", name: "ENABLE_DIARY_WRITER", label: "夜整后写叙事日记", hint: "默认开启。填 false 不写日记" },
  { group: "Dream 与日记", name: "DIARY_MODEL", label: "日记和月记用的模型", hint: "留空回落 DREAM_MODEL" },
  { group: "Dream 与日记", name: "SUMMARY_MODEL", label: "摘要模型的最后兜底", hint: "DREAM_MODEL 和旧名 DAILY_DIGEST_MODEL 都没填时，摘要链路用它" },
  { group: "Dream 与日记", name: "ENABLE_WEEKLY_ROLLUP", label: "周记汇总", hint: "默认开启。填 false 不生成 weekly_log，命中也就没有周块可附" },
  { group: "Dream 与日记", name: "ENABLE_MONTHLY_ROLLUP", label: "月记汇总", hint: "默认开启。填 false 不生成 monthly_log" },
  { group: "Dream 与日记", name: "JUDGE_MODEL", label: "候选审核用的模型", hint: "留空回落 DREAM_MODEL；两者都空就跳过自动审核，全部走人工" },
  { group: "Dream 与日记", name: "TRIGGER_BUILD", label: "夜里给新记忆建触发器", hint: "默认 off。填 on 或 true 后，夜批给当天新记忆生成检索触发器。成本是每条记忆一次模型调用加三次向量化，只建增量，已有触发器的记忆跳过" },
  { group: "Dream 与日记", name: "TRIGGER_BUILD_MODEL", label: "建触发器用哪个模型", hint: "留空回落 DREAM_MODEL。触发器质量直接决定这条通道有没有用，别用太小的模型" },
  { group: "Dream 与日记", name: "JUDGE_MAX_CANDIDATES", label: "一轮最多审几条候选", hint: "默认 20，上限 100" },
  { group: "Dream 与日记", name: "JUDGE_APPROVE_MIN", label: "自动入库阈值", hint: "默认 0.8。评分不低于它自动入库" },
  { group: "Dream 与日记", name: "JUDGE_DISCARD_MAX", label: "自动丢弃阈值", hint: "默认 0.3。评分不高于它自动丢弃，中间留人工" },
  { group: "Dream 与日记", name: "EMPTY_MEMORY_MIN_CHARS", label: "空记忆最短字符数", hint: "默认 4。短于这个长度的抽取结果当空记忆丢掉" },

  { group: "数据留存", name: "MESSAGES_RETENTION_DAYS", label: "原始对话保留天数", hint: "Dream 抽完记忆后，原文留几天" },

  { group: "模型与线路", name: "AI_GATEWAY_ID", label: "默认 AI Gateway ID", hint: "会写进上游 URL。自定义 Provider 和动态路由必须填对，不能只靠账户默认 Gateway" },
  { group: "模型与线路", name: "UPSTREAM_STRIP_TOOL_FIELDS", label: "始终剥离的工具字段", hint: "逗号分隔，例如 eager_input_streaming,cache_control。填上就每次先剥，不再等上游那次 400。留空则按线路学习：只在被拒一次后自动剥离（换 isolate 会重学一次），接受该字段的上游不受影响。工具的身份字段 name/description/input_schema/type 会被拒绝" },
  { group: "模型与线路", name: "VISION_MODEL", label: "看图模型" },
  { group: "模型与线路", name: "CHAT_MODEL", label: "导盲犬入口的模型", hint: "只给 /v1/guide-dog 用，聊天走网关身份" },
  { group: "模型与线路", name: "PUBLIC_MODEL_NAME", label: "导盲犬对外显示的模型名" },
  { group: "模型与线路", name: "DEFAULT_UPSTREAM_MODEL", label: "上游模型兜底名", hint: "CHAT_MODEL 没填时用它" },
  { group: "模型与线路", name: "ALLOW_MODEL_PASSTHROUGH", label: "允许客户端指定模型", hint: "默认关闭，客户端传什么模型名都落到 CHAT_MODEL。填 true 后导盲犬入口按客户端给的模型名原样转发，等于放开模型选择" },

  { group: "GitHub 日档（可选）", name: "GITHUB_DAILY_REPO", label: "仓库", hint: "owner/repo；留空就是不启用" },
  { group: "GitHub 日档（可选）", name: "GITHUB_DAILY_PATH", label: "仓库里的路径", hint: "默认 archive/daily" },
  { group: "GitHub 日档（可选）", name: "GITHUB_DAILY_NAMESPACE", label: "写进哪个记忆空间" },

  { group: "高级 · 改了要重建向量库", name: "EMBEDDING_MODEL", label: "向量模型" },
  { group: "高级 · 改了要重建向量库", name: "EMBEDDING_DIMENSIONS", label: "向量维度", hint: "必须和 Vectorize 索引一致，对不上就整个召不回" },
  { group: "高级 · 改了要重建向量库", name: "VECTORIZE_INDEX_NAME", label: "Vectorize 索引名" }
];
export const SETTING_NAMES = new Set(SETTINGS.map(s => s.name));
const RETIRED_SETTINGS = new Set(["RECALL_SELECTOR_MODEL", "RECALL_SELECTOR_TIMEOUT_MS"]);

// Credentials stay Worker Secrets; the page only reports whether they exist.
export const SECRET_SPECS: { name: string; label: string }[] = [
  { name: "CHATBOX_API_KEY", label: "主密钥（必填，客户端和本页都用它）" },
  { name: "IM_API_KEY", label: "第二个客户端密钥" },
  { name: "DEBUG_API_KEY", label: "维护密钥（跨记忆空间操作）" },
  { name: "MEMORY_MCP_API_KEY", label: "MCP 密钥" },
  { name: "GUIDE_DOG_API_KEY", label: "导盲犬密钥" },
  { name: "CLOUDFLARE_API_TOKEN", label: "CF 令牌（网关上游就靠它，一把管所有）" },
  { name: "CF_AIG_TOKEN", label: "AI Gateway 认证令牌（网关开了 authenticated gateway 才要）" },
  { name: "GITHUB_DAILY_TOKEN", label: "GitHub 日档只读 PAT" }
];

export function validateSettings(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("settings must be an object");
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (RETIRED_SETTINGS.has(name)) continue;
    if (!SETTING_NAMES.has(name)) throw new Error(`Unknown setting: ${name}`);
    if (typeof raw !== "string") throw new Error(`${name}: settings values must be strings`);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > 512) throw new Error(`${name}: value too long`);
    out[name] = trimmed;
  }
  return out;
}
/** Saved settings win over Worker vars; blanks fall through to the deployed defaults. */
export function applySettings(env: Env, settings: Record<string, string> | undefined): Env {
  if (!settings) return env;
  const overrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(settings)) if (SETTING_NAMES.has(name)) overrides[name] = value;
  return Object.keys(overrides).length ? { ...env, ...overrides } : env;
}
export function describeSettings(env: Env, settings: Record<string, string>) {
  const source = env as unknown as Record<string, unknown>;
  const groups: { group: string; items: unknown[] }[] = [];
  for (const spec of SETTINGS) {
    const deployed = source[spec.name];
    let group = groups.find(g => g.group === spec.group);
    if (!group) { group = { group: spec.group, items: [] }; groups.push(group); }
    group.items.push({
      name: spec.name, label: spec.label, hint: spec.hint || "",
      value: settings[spec.name] || "",
      deployed: typeof deployed === "string" ? deployed : ""
    });
  }
  return { groups, secrets: SECRET_SPECS.map(s => ({ ...s, present: !!source[s.name] })) };
}
