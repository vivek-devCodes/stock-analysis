import "server-only";
import { getDb } from "../db/client";
import type { DailyReport, SessionPlan } from "./types";

/** Next-session plans and daily reports: Postgres when configured, otherwise process memory. */

const memory = { plans: new Map<string, SessionPlan>(), reports: new Map<string, DailyReport>() };
const parse = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

/** Saves (or replaces) the plan for its day — but never overwrites one that has started executing. */
export async function savePlan(plan: SessionPlan): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const cur = memory.plans.get(plan.madeOn);
    if (cur && cur.status !== "pending") return false;
    memory.plans.set(plan.madeOn, plan);
    return true;
  }
  const rows = await db.query<{ made_on: string }>(
    `insert into paper_plans (made_on, status, data) values ($1, $2, $3::jsonb)
     on conflict (made_on) do update set status = excluded.status, data = excluded.data, created_at = now()
     where paper_plans.status = 'pending' returning made_on`,
    [plan.madeOn, plan.status, JSON.stringify(plan)],
  );
  return rows.length > 0;
}

export async function getPlan(madeOn: string): Promise<SessionPlan | null> {
  const db = await getDb();
  if (!db) return memory.plans.get(madeOn) ?? null;
  const rows = await db.query<{ data: SessionPlan | string }>(`select data from paper_plans where made_on = $1`, [madeOn]);
  return rows[0] ? parse(rows[0].data) : null;
}

export async function latestPlan(): Promise<SessionPlan | null> {
  const db = await getDb();
  if (!db) return [...memory.plans.values()].sort((a, b) => b.madeOn.localeCompare(a.madeOn))[0] ?? null;
  const rows = await db.query<{ data: SessionPlan | string }>(`select data from paper_plans order by made_on desc limit 1`);
  return rows[0] ? parse(rows[0].data) : null;
}

/**
 * Claims the newest pending plan made before `today` for execution (so it runs exactly once, even
 * if the cron and the page fire together). Older pending plans are expired.
 */
export async function claimPendingPlan(today: string, expireBefore: string): Promise<SessionPlan | null> {
  const db = await getDb();
  if (!db) {
    const pending = [...memory.plans.values()].filter((p) => p.status === "pending" && p.madeOn < today).sort((a, b) => b.madeOn.localeCompare(a.madeOn));
    for (const p of pending.slice(1)) memory.plans.set(p.madeOn, { ...p, status: "expired" });
    const p = pending[0];
    if (!p || p.madeOn < expireBefore) {
      if (p) memory.plans.set(p.madeOn, { ...p, status: "expired" });
      return null;
    }
    const claimed = { ...p, status: "executing" as const };
    memory.plans.set(p.madeOn, claimed);
    return claimed;
  }
  const newest = await db.query<{ made_on: string }>(`select made_on from paper_plans where status = 'pending' and made_on < $1 order by made_on desc limit 1`, [today]);
  const keep = newest[0]?.made_on ?? null;
  const expire = `update paper_plans set status = 'expired', data = jsonb_set(data, '{status}', '"expired"') where status = 'pending'`;
  // Older pending plans (e.g. made before a holiday) are superseded by the newest one.
  await db.query(`${expire} and made_on < $1 and made_on <> $2`, [today, keep ?? ""]);
  if (!keep) return null;
  if (keep < expireBefore) {
    await db.query(`${expire} and made_on = $1`, [keep]);
    return null;
  }
  const rows = await db.query<{ data: SessionPlan | string }>(
    `update paper_plans set status = 'executing', data = jsonb_set(data, '{status}', '"executing"') where made_on = $1 and status = 'pending' returning data`,
    [keep],
  );
  return rows[0] ? parse(rows[0].data) : null;
}

export async function finishPlan(plan: SessionPlan): Promise<void> {
  const db = await getDb();
  if (!db) {
    memory.plans.set(plan.madeOn, plan);
    return;
  }
  await db.query(`update paper_plans set status = $2, data = $3::jsonb where made_on = $1`, [plan.madeOn, plan.status, JSON.stringify(plan)]);
}

/** The plan that was executed on `day` (entries at that day's open). */
export async function planExecutedOn(day: string): Promise<SessionPlan | null> {
  const db = await getDb();
  if (!db) return [...memory.plans.values()].find((p) => p.execution?.day === day) ?? null;
  const rows = await db.query<{ data: SessionPlan | string }>(`select data from paper_plans where data->'execution'->>'day' = $1 order by made_on desc limit 1`, [day]);
  return rows[0] ? parse(rows[0].data) : null;
}

/* ------------------------------------------------ reports ------------------------------------------------ */

export async function saveDailyReport(r: DailyReport): Promise<void> {
  const db = await getDb();
  if (!db) {
    memory.reports.set(r.day, r);
    return;
  }
  await db.query(`insert into paper_reports (day, data) values ($1, $2::jsonb) on conflict (day) do update set data = excluded.data, created_at = now()`, [r.day, JSON.stringify(r)]);
}

export async function listDailyReports(limit = 15): Promise<DailyReport[]> {
  const db = await getDb();
  if (!db) return [...memory.reports.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  const rows = await db.query<{ data: DailyReport | string; emailed: string | null }>(`select data, emailed from paper_reports order by day desc limit $1`, [limit]);
  return rows.map((r) => ({ ...parse(r.data), emailed: r.emailed }));
}

/** True the first time the report email for `day` is claimed (no duplicate emails). */
export async function claimReportEmail(day: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const rows = await db.query<{ day: string }>(`update paper_reports set emailed = 'pending' where day = $1 and emailed is null returning day`, [day]);
  return rows.length > 0;
}

export async function markReportEmail(day: string, status: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const r = memory.reports.get(day);
    if (r) memory.reports.set(day, { ...r, emailed: status });
    return;
  }
  await db.query(`update paper_reports set emailed = $2 where day = $1`, [day, status.slice(0, 200)]);
}
