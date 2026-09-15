// Trigger 写入期 prompt (借鉴 T-Mem, EMNLP 2026)。
//
// 一条触发器只有两条合法路线，其余一律废弃：
//   路线 A 语义锚点：沿 is-a 阶梯往上一两级的名词短语，是这条记忆自己的语义被泛化。
//   路线 B 强关联场景：提到这个场景/道具/情境时，这条记忆大概率该被想起来。
//
// 三类废品必须挡掉，它们是这套方法失效的主要原因：
//   复述     —— 把记忆换个说法压成几个词，检索上等于没加东西。
//   过泛标签 —— 什么都套得上，召回时把一堆无关记忆一起拽进来。
//   弱关联场景 —— 场景能挂在很多条记忆上，提到它并不指向这一条。
//
// bridge 不是注释，它自己也进检索 (三视图之一)。所以要求它写成
// 「<记忆里的线索> -> <一步推理>」，而不是给触发器贴个类型标签。

export interface TriggerDraft {
  concept: string;
  bridge: string;
  confidence: number;
}

const CONCEPT_MIN_LEN = 2;
const CONCEPT_MAX_LEN = 40;
const BRIDGE_MAX_LEN = 60;

export function buildTriggerPrompt(input: {
  content: string;
  count: number;
  occurredAt?: string | null;
}): string {
  const when = input.occurredAt ? `\n时间：${input.occurredAt}` : "";
  return [
    "你在为一条记忆生成检索触发器。触发器比记忆本身高一两级，",
    "作用是：以后有人提到触发器里的说法，这条记忆能被捞回来。",
    "",
    `为下面这条记忆生成 ${input.count} 条触发器。每条是 2-6 个词的短名词短语。`,
    "",
    "## 记忆",
    `内容：${input.content}${when}`,
    "",
    "## 两条合法路线（每条触发器必须且只能属于其中一条）",
    "",
    "A 语义锚点：给这条记忆起一个更上位的名字。是它自己的语义，往上泛化一两级。",
    "B 强关联场景：一个具体的场景、道具或处境，提到它的时候这条记忆大概率该出现。",
    "  只有强关联算数，顺带沾边的不算。",
    "",
    "## 三类必须废弃的写法",
    "",
    "复述：把记忆本身换个说法压成几个词。检索上等于什么都没加。",
    "过泛标签：什么都套得上，这条记忆的特异性全丢了。",
    "弱关联场景：这个场景能挂在很多条不相干的记忆上，提到它并不指向这一条。",
    "",
    "## 例子",
    "",
    "记忆：「他在聚餐上吃了虾之后起了荨麻疹」",
    "",
    "路线 A 合格：海鲜不耐受 / 食物过敏 / 过敏反应",
    "路线 B 合格：海鲜自助餐 / 在寿司店点单",
    "不合格：虾过敏（复述）、健康问题（过泛）、包里的肾上腺素笔（任何过敏都成立，弱关联）",
    "",
    "## bridge 字段",
    "",
    "每条触发器附一句 bridge，说明它为什么是这条记忆的合法触发器。",
    "格式：<从记忆里摘的线索> -> <一步推理>。",
    "线索必须来自记忆自己的措辞；推理必须是真的一步——归类、因果、或者「在这个场合下这条记忆用得上」。",
    "不要复述触发器本身，也不要写「语义锚点」这种类型标签。",
    "",
    "合格：海鲜不耐受 -> bridge：虾属于海鲜；吃完起荨麻疹即不耐受",
    "合格：在寿司店点单 -> bridge：点单菜单是虾过敏起作用的决策点",
    "",
    "## confidence",
    "",
    "一个认识这个人的听众，听到触发器能联想回这条记忆的可靠程度。逐条按实际给，不要凑分布。",
    "",
    "0.8-1.0：贴身的中层锚点，或几乎必然带出这条记忆的场景。",
    "0.5-0.8：清楚的上位锚点，或强烈但不必然带出的场景。",
    "0.3-0.5：更宽的上位概念，或中等关联的场景。",
    "0.3 以下：很宽的类目或弱关联场景——除非实在没有更好的，否则别写。",
    "",
    "## 输出",
    "",
    "只输出 JSON，不要 markdown，不要解释。",
    '{"triggers":[{"concept":"2-6 个词","bridge":"<线索> -> <推理>","confidence":0.0}]}'
  ].join("\n");
}

function isCleanConcept(concept: string): boolean {
  if (concept.length < CONCEPT_MIN_LEN || concept.length > CONCEPT_MAX_LEN) return false;
  // 模型偶尔把整句塞进 concept；带句末标点的一律当没遵守长度约束。
  if (/[。！？；.!?;]/.test(concept)) return false;
  return true;
}

// 复述闸：concept 和记忆正文高度重合时判为复述。
// 字符级包含是最便宜也最准的判据——「虾过敏」对「吃了虾之后起了荨麻疹」不成立包含，
// 所以这里只挡最直白的那一类，剩下的交给 prompt 和 confidence。
function isRestatement(concept: string, content: string): boolean {
  const c = concept.replace(/\s+/g, "");
  if (!c) return true;
  const body = content.replace(/\s+/g, "");
  return body.includes(c) && c.length >= Math.min(8, body.length);
}

export function parseTriggerResponse(
  raw: string,
  input: { content: string; minConfidence: number }
): TriggerDraft[] {
  let parsed: unknown;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const list = (parsed as { triggers?: unknown }).triggers;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: TriggerDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const concept = typeof rec.concept === "string" ? rec.concept.trim() : "";
    const bridge = typeof rec.bridge === "string" ? rec.bridge.trim() : "";
    const confidence = typeof rec.confidence === "number" ? rec.confidence : Number.NaN;
    if (!concept || !isCleanConcept(concept)) continue;
    if (!Number.isFinite(confidence) || confidence < input.minConfidence) continue;
    if (isRestatement(concept, input.content)) continue;
    const key = concept.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      concept,
      bridge: bridge.slice(0, BRIDGE_MAX_LEN),
      confidence: Math.min(Math.max(confidence, 0), 1)
    });
  }
  return out;
}
