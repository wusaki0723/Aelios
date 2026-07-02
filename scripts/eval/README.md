# 抽取质量 eval

## 这是干什么用的

记忆抽取 prompt (`src/memory/extractPipeline.ts` 里的 `buildExtractPrompt`) 已经改过很多版，
每次改完都是凭手感判断"好像好一点/好像差一点"，没有一个能复现的数字。这套 eval 给抽取质量一个
可测的分数，改 prompt 之后跑一遍就知道是变好还是变差，不用再靠印象。

harness 走的是**真实生产路径**：MCP 工具 `memory_extract_dryrun` 内部直接调用
`runExtractionDryRun` -> `callExtractModel`（跟线上抽取用同一份 prompt、同一个模型、同一套
`normalizeCandidate` 归一化），只是不落库、不推进游标、不写候选队列。所以这里量出来的分数就是
线上会发生的事，不会因为 eval 脚本自己维护了一份"抽取逻辑的影子实现"而跟生产行为逐渐漂移。

## JSONL 格式

`scripts/eval/sample.jsonl` 每行一个 JSON 对象，一个对象是一个测试用例：

```jsonc
{
  "id": "durable_fact_relocation",       // 用例名，随便起，报告里认这个
  "messages": [                          // 喂给抽取器的一段对话窗口
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "expected": [                          // 期望抽出的记忆；空数组 [] 表示"这段什么都不该抽"
    {
      "content": "...",                  // 期望的记忆原文，用来做相似度比较
      "type": "fact",                    // 可选，目前评分没用到，留着给人看
      "fact_key": "user:location"        // 可选，如果标了且抽取结果也有 fact_key，走精确匹配
    }
  ]
}
```

`expected: []` 的用例（负样本）跟正样本一样重要，甚至更重要：一个爱抽风、把寒暄和临时计划也存
成记忆的抽取器，在只看正样本召回率的时候反而分数很好看。负样本专门用来抓这种"多抽"的毛病，报告
里会单独统计"负样本违规数"（`expected` 是空但抽取器还是吐出东西了的用例数）。

## 怎么从生产数据攒一份真实标注集（30-50 条）

1. 从 D1 的 `messages` 表按 `namespace` + 时间窗导出真实对话片段（可以照抄
   `runMemoryExtractionWindow` 里 4 小时窗口的切法，或者干脆挑几个你记得内容的窗口，方便手工判断
   该不该抽）。
2. 每条窗口人工过一遍，写出"这段话里到底有没有值得长期记住的稳定事实"，标成 `expected`。标注一次
   就行，不用每次跑 eval 都重标——这份标注集就是以后判断 prompt 改动好坏的基准线。
3. **刻意留出大约 1/3 的负样本**：纯寒暄、吐槽天气、讨论中午吃什么、临时性的提醒/计划（"下周三
   打疫苗提醒我"这种），标 `expected: []`。抽取器规则里明确写了"临时计划和意图不是稳定事实"，负
   样本就是用来验证这条规则真的在生效，而不是被 prompt 的其他部分盖过去了。
4. 建议用例结构大致是：稳定事实（身份、位置、长期习惯）、偏好（喜欢/讨厌什么）、边界
   （不许做什么）、决定/习惯，各来几条，正负样本混着放，不用分文件，一个 JSONL 里全放。
5. 存成 `scripts/eval/<有意义的名字>.jsonl`，跑的时候用 `--file` 指过去，不用覆盖
   `sample.jsonl`（那个是演示格式用的合成数据，不是真实标注集）。

## 打分怎么算的

- 每条 `expected` 项，如果抽取结果里存在一条：
  - `fact_key` 双方都有且完全相等，**或者**
  - 内容归一化（转小写、去掉空白和标点）后按字符 bigram 算 Dice 系数 `>= 0.5`，
  就算命中（HIT），贪心匹配，一条抽取结果最多只能顶一条 expected，不会重复计数。
- 没被任何 expected 匹配上的抽取结果算 FALSE POSITIVE（多抽了）。
- 没被匹配上的 expected 算 MISS（该抽的没抽到）。
- 每条用例给出 precision / recall；`expected` 是空数组的用例不算 recall（分母是 0），但会检查
  "负样本违规"：只要抽出了任何东西就算违规。
- 汇总用 micro precision / recall / F1（把所有用例的 TP/FP/FN 加总再算，样本数多的用例自然权重
  更大）。

这套脚本只是报告，**exit code 恒为 0**，不是拿来当 CI gate 用的——先把数字跑出来，人看着改
prompt，等你觉得某个阈值可以当门槛了，再自己包一层判断退出码。

## 用法

```bash
# 跑演示数据集，表格输出
node scripts/eval-extract.mjs \
  --endpoint "https://your-worker.workers.dev/mcp?token=YOUR_TOKEN" \
  --file scripts/eval/sample.jsonl

# 指定 namespace，输出机器可读 JSON（方便脚本比较两次跑分）
node scripts/eval-extract.mjs \
  --endpoint "https://your-worker.workers.dev/mcp?token=YOUR_TOKEN" \
  --file scripts/eval/my-real-cases.jsonl \
  --namespace default \
  --json
```

改完 prompt，本地 `wrangler dev` 起一份，`--endpoint` 指向本地地址，跑一遍分数，再跑一遍改前的
版本（`git stash` 一下 prompt 改动），对比两次的 micro F1 和负样本违规数，就知道这版 prompt 是
真的变好了还是只是感觉变好了。
