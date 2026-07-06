# eval harness（已随 v3-slim 退役）

v3 移除了 4h `extractPipeline` 和 `memory_extract_dryrun` MCP 工具。夜间抽取改由 dream 管线（`src/memory/dreamExtract.ts`）在每日 cron 中执行，产物全部进 candidates 审核队列。

如需评估 dream 抽取质量，使用 `POST /v1/dream/run` 且 `dry_run=true`，查看返回的 `extracted_memories` 与 `routing_plan`。