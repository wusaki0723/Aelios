/**
 * Stable import path for the dream/daily-digest pipeline.
 * Implementation lives under src/memory/dream/ — this file re-exports the public surface.
 */
export {
  addDaysToDateLabel,
  buildDreamRoutingPlan,
  countRawMessagesForDateLabel,
  getDateLabelsLookback,
  getDateRangeForLabel,
  getTargetDigestDateLabel,
  readDailyCursor,
  readDreamCursorValue,
  readDreamTimeZoneFromEnv,
  runDailyMemoryDigest,
  runDreamBackfill
} from "./dream/orchestrator";

export type {
  DailyDigestRunOptions,
  DailyDigestRunResult,
  DailyDigestStats,
  DreamRoutingItem,
  DreamRoutingPlan
} from "./dream/orchestrator";
