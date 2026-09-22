import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isMemoryId, sanitizeDreamDigestLists } from "../src/memory/dream/judgePhase";

const ID_A = "mem_ce6ba9923cff45fb971ec81141b8a547";
const ID_B = "mem_70a4cd866644455791339d299c008640";

test("isMemoryId only accepts mem_ + 32 lowercase hex", () => {
  assert.equal(isMemoryId(ID_A), true);
  assert.equal(isMemoryId("mem_ce6ba992"), false);
  assert.equal(isMemoryId("mem_CE6BA9923CFF45FB971EC81141B8A547"), false);
  assert.equal(isMemoryId(`${ID_A}0`), false);
  assert.equal(isMemoryId("cand_ce6ba9923cff45fb971ec81141b8a547"), false);
  assert.equal(isMemoryId(""), false);
  assert.equal(isMemoryId(null), false);
});

test("truncated update targets are dropped before they reach the candidate queue", () => {
  const { updates } = sanitizeDreamDigestLists(
    [
      { target_id: "mem_ce6ba992", content: "健康监督日常节奏：……" },
      { target_id: ID_A, content: "健康监督日常节奏：完整版" }
    ] as never,
    []
  );
  assert.deepEqual(updates.map((item) => item.target_id), [ID_A]);
});

test("malformed delete targets are dropped and do not mask a valid update", () => {
  const { updates, deletes } = sanitizeDreamDigestLists(
    [{ target_id: ID_B, content: "phone-for-ai 还在计划里" }] as never,
    [{ target_id: "mem_70a4cd86" }] as never
  );
  assert.deepEqual(deletes, []);
  assert.deepEqual(updates.map((item) => item.target_id), [ID_B]);
});

test("a well-formed delete still shadows the update on the same memory", () => {
  const { updates, deletes } = sanitizeDreamDigestLists(
    [{ target_id: ID_B, content: "改写" }] as never,
    [{ target_id: ID_B }] as never
  );
  assert.deepEqual(updates, []);
  assert.deepEqual(deletes.map((item) => item.target_id), [ID_B]);
});

test("duplicate update targets collapse to the first one", () => {
  const { updates } = sanitizeDreamDigestLists(
    [
      { target_id: ID_A, content: "第一条" },
      { target_id: ID_A, content: "第二条" }
    ] as never,
    []
  );
  assert.equal(updates.length, 1);
  assert.equal((updates[0] as { content: string }).content, "第一条");
});
