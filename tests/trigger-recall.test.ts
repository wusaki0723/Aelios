import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_TRIGGER_GATE,
  isTriggerRecallEnabled,
  selectTriggeredMemories,
  triggerRecallGate,
  triggerRecallTopK,
  type SelectableTriggerMatch
} from "../src/memory/triggers/select";
import { parseTriggerResponse } from "../src/memory/triggers/prompt";
import { TRIGGER_NS_PREFIX, triggerNamespace } from "../src/memory/triggers/store";

const match = (
  key: string,
  memoryId: string,
  score: number,
  concept = key
): SelectableTriggerMatch => ({
  trigger_key: key,
  memory_id: memoryId,
  concept,
  score,
  confidence: 0.8
});

const opts = { gate: DEFAULT_TRIGGER_GATE, maxTriggers: 10 };

test("the channel is off unless explicitly turned on", () => {
  assert.equal(isTriggerRecallEnabled({} as never), false);
  assert.equal(isTriggerRecallEnabled({ TRIGGER_RECALL: "off" } as never), false);
  assert.equal(isTriggerRecallEnabled({ TRIGGER_RECALL: "yes" } as never), false);
  assert.equal(isTriggerRecallEnabled({ TRIGGER_RECALL: "on" } as never), true);
  assert.equal(isTriggerRecallEnabled({ TRIGGER_RECALL: "1" } as never), true);
});

test("a config below the default gate cannot loosen it", () => {
  assert.equal(triggerRecallGate({ TRIGGER_RECALL_GATE: "0.3" } as never), DEFAULT_TRIGGER_GATE);
  assert.equal(triggerRecallGate({ TRIGGER_RECALL_GATE: "0.92" } as never), 0.92);
  assert.equal(triggerRecallGate({ TRIGGER_RECALL_GATE: "nonsense" } as never), DEFAULT_TRIGGER_GATE);
  assert.equal(triggerRecallGate({ TRIGGER_RECALL_GATE: "2" } as never), DEFAULT_TRIGGER_GATE);
});

test("top-k is clamped and defaulted", () => {
  assert.equal(triggerRecallTopK({} as never), 10);
  assert.equal(triggerRecallTopK({ TRIGGER_RECALL_TOP_K: "3" } as never), 3);
  assert.equal(triggerRecallTopK({ TRIGGER_RECALL_TOP_K: "999" } as never), 50);
  assert.equal(triggerRecallTopK({ TRIGGER_RECALL_TOP_K: "0" } as never), 10);
});

test("nothing fires when the best trigger is below the gate", () => {
  const out = selectTriggeredMemories([match("t1", "m1", 0.84), match("t2", "m2", 0.5)], opts);
  assert.equal(out.triggered, false);
  assert.deepEqual(out.memories, []);
  assert.equal(out.best_score, 0.84);
  assert.match(out.reason, /no trigger passed gate/);
});

test("one memory reached by several triggers is returned once, at its best score", () => {
  const out = selectTriggeredMemories(
    [match("t1", "m1", 0.87, "海鲜不耐受"), match("t2", "m1", 0.93, "在寿司店点单")],
    opts
  );
  assert.equal(out.triggered, true);
  assert.equal(out.memories.length, 1);
  assert.equal(out.memories[0].memory_id, "m1");
  assert.equal(out.memories[0].trigger_score, 0.93);
  assert.equal(out.memories[0].via_concept, "在寿司店点单");
});

test("selection never mutates or reorders the caller's matches", () => {
  const input = [match("t1", "m1", 0.5), match("t2", "m2", 0.99)];
  const snapshot = JSON.parse(JSON.stringify(input));
  selectTriggeredMemories(input, opts);
  assert.deepEqual(input, snapshot);
});

test("NaN scores are dropped rather than ordered", () => {
  const out = selectTriggeredMemories([match("t1", "m1", Number.NaN), match("t2", "m2", 0.9)], opts);
  assert.equal(out.triggered, true);
  assert.equal(out.memories.length, 1);
  assert.equal(out.memories[0].memory_id, "m2");
});

test("only the first maxTriggers survivors expand", () => {
  const many = Array.from({ length: 12 }, (_, i) => match(`t${i}`, `m${i}`, 0.9 + i * 0.001));
  const out = selectTriggeredMemories(many, { gate: DEFAULT_TRIGGER_GATE, maxTriggers: 3 });
  assert.equal(out.memories.length, 3);
  // highest scores first
  assert.deepEqual(out.memories.map((m) => m.memory_id), ["m11", "m10", "m9"]);
});

// --- 写入期解析 ---

const CONTENT = "他在聚餐上吃了虾之后起了荨麻疹";
const parse = (raw: string) => parseTriggerResponse(raw, { content: CONTENT, minConfidence: 0.7 });

test("a well-formed trigger set parses", () => {
  const out = parse(
    JSON.stringify({
      triggers: [
        { concept: "海鲜不耐受", bridge: "虾属于海鲜；吃完起荨麻疹即不耐受", confidence: 0.9 },
        { concept: "在寿司店点单", bridge: "点单菜单是虾过敏起作用的决策点", confidence: 0.75 }
      ]
    })
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].concept, "海鲜不耐受");
});

test("low-confidence triggers are dropped at build time", () => {
  const out = parse(
    JSON.stringify({ triggers: [{ concept: "食物相关", bridge: "x -> y", confidence: 0.4 }] })
  );
  assert.deepEqual(out, []);
});

test("a restatement of the memory is not a trigger", () => {
  const out = parse(
    JSON.stringify({
      triggers: [{ concept: "吃了虾之后起了荨麻疹", bridge: "x -> y", confidence: 0.95 }]
    })
  );
  assert.deepEqual(out, []);
});

test("a whole sentence in the concept field is rejected", () => {
  const out = parse(
    JSON.stringify({
      triggers: [{ concept: "这个人对海鲜过敏，所以要小心。", bridge: "x -> y", confidence: 0.9 }]
    })
  );
  assert.deepEqual(out, []);
});

test("duplicate concepts collapse to one", () => {
  const out = parse(
    JSON.stringify({
      triggers: [
        { concept: "食物过敏", bridge: "a -> b", confidence: 0.9 },
        { concept: "食物过敏", bridge: "c -> d", confidence: 0.8 }
      ]
    })
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].bridge, "a -> b");
});

test("malformed model output yields nothing rather than throwing", () => {
  assert.deepEqual(parse("not json at all"), []);
  assert.deepEqual(parse(""), []);
  assert.deepEqual(parse('{"triggers": "nope"}'), []);
  assert.deepEqual(parse('{"no_triggers": []}'), []);
});

test("json wrapped in prose or fences is still recovered", () => {
  const out = parse(
    '```json\n{"triggers":[{"concept":"海鲜不耐受","bridge":"虾是海鲜 -> 不耐受","confidence":0.9}]}\n```'
  );
  assert.equal(out.length, 1);
});

test("confidence is clamped into [0,1]", () => {
  const out = parse(
    JSON.stringify({ triggers: [{ concept: "过敏反应", bridge: "a -> b", confidence: 1.7 }] })
  );
  assert.equal(out[0].confidence, 1);
});

// 隔离不变量：触发器向量与记忆向量共用 memo-kb 索引，只靠 `trg:` 前缀分家。
// searchVectorMemories 的 legacy 查询不带 filter，仅用 metadata.namespace 严格相等
// 兜底；前缀一旦为空或被改成真实 namespace 的前缀，触发器就会作为记忆被召回。
// 这三条断言把前缀钉死——去掉前缀时它们必须红。
test("trigger namespace is prefixed and never equals the real namespace", () => {
  assert.equal(TRIGGER_NS_PREFIX, "trg:");
  for (const ns of ["default", "saki", "trg", "", "a:b"]) {
    const tagged = triggerNamespace(ns);
    assert.notEqual(tagged, ns);
    assert.ok(tagged.startsWith("trg:"));
  }
});

test("trigger namespace prefix is non-empty so legacy strict-equality cannot match", () => {
  // 空前缀会让 triggerNamespace("default") === "default"，直接漏进记忆召回。
  assert.ok(TRIGGER_NS_PREFIX.length > 0);
  assert.equal(triggerNamespace("default"), "trg:default");
});

test("trigger namespace is injective and stable", () => {
  assert.notEqual(triggerNamespace("a"), triggerNamespace("b"));
  assert.equal(triggerNamespace("saki"), triggerNamespace("saki"));
});
