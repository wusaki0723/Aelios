import type { Env } from "../../types";
import { runDiaryWriterNightly } from "../diaryWriter";
import { runGithubDailyPull } from "../githubDaily";
import { runMonthlyRollup } from "../monthlyRollup";
import { runWeeklyRollup } from "../weeklyRollup";

export interface RollupPhaseResults {
  diaryWriter: Awaited<ReturnType<typeof runDiaryWriterNightly>> | { ok: false };
  githubDaily: Awaited<ReturnType<typeof runGithubDailyPull>> | { ok: false };
  weeklyRollup: Awaited<ReturnType<typeof runWeeklyRollup>> | { ok: false };
  monthlyRollup: Awaited<ReturnType<typeof runMonthlyRollup>> | { ok: false };
}

/**
 * Nightly rollup triggers: diary → (caller may interleave retention) → github daily →
 * weekly → monthly. Execution order of diary/github/weekly/monthly is preserved relative
 * to the prior index.ts scheduled handler when invoked in that sequence.
 *
 * Serial (not parallel): diary first, then github, then weekly, then monthly —
 * matching the historical order of diary → … → github (parallel with retention) → weekly → monthly.
 * Callers that need retention in parallel with github should call githubDailyPull alone;
 * this helper keeps a pure serial rollup sequence for the four named triggers.
 */
export async function runRollupPhase(env: Env, namespace: string): Promise<RollupPhaseResults> {
  let diaryWriter: Awaited<ReturnType<typeof runDiaryWriterNightly>> | { ok: false };
  try {
    diaryWriter = await runDiaryWriterNightly(env, namespace);
  } catch (error) {
    console.error("scheduled diary writer failed", {
      namespace,
      error: error instanceof Error ? error.message : String(error)
    });
    diaryWriter = { ok: false };
  }

  let githubDaily: Awaited<ReturnType<typeof runGithubDailyPull>> | { ok: false };
  try {
    // 04:10 SGT cron (20:10 UTC) runs ~4h after cmh-lite's 23:50 local push — safe to pull yesterday's daily.
    githubDaily = await runGithubDailyPull(env);
    console.log("github daily pull", githubDaily);
  } catch (e) {
    console.error("github daily pull failed", String(e));
    githubDaily = { ok: false };
  }

  let weeklyRollup: Awaited<ReturnType<typeof runWeeklyRollup>> | { ok: false };
  try {
    weeklyRollup = await runWeeklyRollup(env, namespace);
  } catch (error) {
    console.error("scheduled weekly rollup failed", {
      namespace,
      error: error instanceof Error ? error.message : String(error)
    });
    weeklyRollup = { ok: false };
  }

  let monthlyRollup: Awaited<ReturnType<typeof runMonthlyRollup>> | { ok: false };
  try {
    monthlyRollup = await runMonthlyRollup(env, namespace);
  } catch (error) {
    console.error("scheduled monthly rollup failed", {
      namespace,
      error: error instanceof Error ? error.message : String(error)
    });
    monthlyRollup = { ok: false };
  }

  return { diaryWriter, githubDaily, weeklyRollup, monthlyRollup };
}

/** Individual triggers for callers that need interleaving (e.g. retention || github). */
export async function runDiaryTrigger(env: Env, namespace: string) {
  return runDiaryWriterNightly(env, namespace);
}

export async function runGithubDailyTrigger(env: Env) {
  return runGithubDailyPull(env);
}

export async function runWeeklyRollupTrigger(env: Env, namespace: string) {
  return runWeeklyRollup(env, namespace);
}

export async function runMonthlyRollupTrigger(env: Env, namespace: string) {
  return runMonthlyRollup(env, namespace);
}
