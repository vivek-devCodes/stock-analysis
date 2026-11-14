import "server-only";
import type { AnalysisReport, Decision, Horizon, RecommendationRow, Validation } from "../agents/types";
import { getDb, type Db } from "./client";

const ACTIONABLE: Validation[] = ["APPROVED"];
const VALIDITY_MS: Record<Horizon, number> = {
  intraday: 24 * 3600_000,
  swing: 14 * 86400_000,
  "long-term": 180 * 86400_000,
};

export type AlertKind = "new" | "changed" | "invalidated";

export type SaveResult = {
  persisted: boolean;
  id: string | null;
  version: number | null;
  /** Which notification, if any, this version warrants (actionable signals only). */
  alert: AlertKind | null;
};

function newId(symbol: string, horizon: Horizon) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const h = horizon === "intraday" ? "ID" : horizon === "swing" ? "SW" : "LT";
  return `REC-${d}-${symbol.replace(/[^A-Z0-9]/gi, "")}-${h}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/**
 * Store an analysis. If an unexpired recommendation exists for the same symbol and horizon, the
 * analysis becomes its next version (never overwritten); otherwise a new recommendation starts.
 */
export async function saveReport(report: AnalysisReport, costRate: number, dbIn?: Db | null): Promise<SaveResult> {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return { persisted: false, id: null, version: null, alert: null };
  const { symbol, horizon } = report.request;
  const plan = report.risk.plan;
  const tracked = plan && report.score.total != null ? plan : null;

  const open = await db.query<{ id: string; current_version: number; validation: Validation; decision: Decision }>(
    `select id, current_version, validation, decision from recommendations
     where symbol = $1 and horizon = $2 and expires_at > now() and status = 'open'
     order by created_at desc limit 1`,
    [report.instrument.symbol, horizon],
  );

  let id: string;
  let version: number;
  let alert: AlertKind | null = null;
  if (open[0]) {
    id = open[0].id;
    version = open[0].current_version + 1;
    const was = open[0].validation;
    const now = report.validation;
    if (ACTIONABLE.includes(was) && !ACTIONABLE.includes(now)) alert = "invalidated";
    else if (ACTIONABLE.includes(now) && (was !== now || open[0].decision !== report.decision)) alert = "changed";
    await db.query(
      `update recommendations set updated_at = now(), current_version = $2, decision = $3, validation = $4, score = $5,
         direction = $6, entry = $7, stop = $8, target = $9, cost_rate = $10
       where id = $1`,
      [id, version, report.decision, report.validation, report.score.total, tracked?.direction ?? null, tracked ? (tracked.entryLow + tracked.entryHigh) / 2 : null, tracked?.stop ?? null, tracked?.targets[0] ?? null, costRate],
    );
  } else {
    id = newId(report.instrument.symbol || symbol, horizon);
    version = 1;
    if (ACTIONABLE.includes(report.validation)) alert = "new";
    await db.query(
      `insert into recommendations (id, symbol, horizon, expires_at, current_version, decision, validation, score, direction, entry, stop, target, cost_rate, status)
       values ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, report.instrument.symbol, horizon, new Date(Date.now() + VALIDITY_MS[horizon]).toISOString(), report.decision, report.validation, report.score.total,
        tracked?.direction ?? null, tracked ? (tracked.entryLow + tracked.entryHigh) / 2 : null, tracked?.stop ?? null, tracked?.targets[0] ?? null, costRate,
        tracked ? "open" : "closed",
      ],
    );
  }

  const stored: AnalysisReport = { ...report, id, version, persisted: true };
  await db.query(
    `insert into recommendation_versions (recommendation_id, version, data_timestamp, decision, validation, score, report)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, version, report.price.timestamp, report.decision, report.validation, report.score.total, JSON.stringify(stored)],
  );
  await db.query(`insert into audit_log (actor, action, detail) values ('agent', 'analysis', $1::jsonb)`, [
    JSON.stringify({ id, version, symbol: report.instrument.symbol, horizon, decision: report.decision, validation: report.validation }),
  ]);
  return { persisted: true, id, version, alert };
}

/** Records an alert once per (recommendation, version, kind). Returns false if it was already recorded. */
export async function claimAlert(id: string, version: number, kind: AlertKind, dbIn?: Db | null): Promise<boolean> {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return true;
  const rows = await db.query<{ id: number }>(
    `insert into alerts (recommendation_id, version, kind, status) values ($1, $2, $3, 'pending')
     on conflict (recommendation_id, version, kind) do nothing returning id`,
    [id, version, kind],
  );
  return rows.length > 0;
}

export async function markAlert(id: string, version: number, kind: AlertKind, status: "sent" | "failed" | "skipped", detail: string, dbIn?: Db | null) {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return;
  await db.query(`update alerts set status = $4, detail = $5 where recommendation_id = $1 and version = $2 and kind = $3`, [id, version, kind, status, detail.slice(0, 500)]);
}

type Row = {
  id: string; symbol: string; horizon: Horizon; created_at: string | Date; updated_at: string | Date; current_version: number;
  decision: Decision; validation: Validation; score: number | null; status: RecommendationRow["status"]; outcome_return_pct: number | null;
};
const isoOf = (v: string | Date) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export async function listRecommendations(limit = 100, dbIn?: Db | null): Promise<RecommendationRow[] | null> {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return null;
  const rows = await db.query<Row>(
    `select id, symbol, horizon, created_at, updated_at, current_version, decision, validation, score, status, outcome_return_pct
     from recommendations order by updated_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id, symbol: r.symbol, horizon: r.horizon, createdAt: isoOf(r.created_at), updatedAt: isoOf(r.updated_at), versions: r.current_version,
    decision: r.decision, validation: r.validation, score: r.score, status: r.status, outcomeReturnPct: r.outcome_return_pct == null ? null : Number(r.outcome_return_pct),
  }));
}

export async function getRecommendation(id: string, dbIn?: Db | null) {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return null;
  const versions = await db.query<{ version: number; created_at: string | Date; decision: Decision; validation: Validation; score: number | null; report: AnalysisReport | string }>(
    `select version, created_at, decision, validation, score, report from recommendation_versions where recommendation_id = $1 order by version desc`,
    [id],
  );
  if (!versions.length) return null;
  const latest = versions[0].report;
  return {
    report: (typeof latest === "string" ? JSON.parse(latest) : latest) as AnalysisReport,
    versions: versions.map((v) => ({ version: v.version, createdAt: isoOf(v.created_at), decision: v.decision, validation: v.validation, score: v.score })),
  };
}

/* ------------------------------- Performance tracking (spec §13) ------------------------------- */

export type OpenRec = { id: string; symbol: string; horizon: Horizon; created_at: string | Date; expires_at: string | Date; direction: "long" | "short"; entry: number; stop: number; target: number; cost_rate: number | null };

export async function openRecommendations(dbIn?: Db | null): Promise<OpenRec[]> {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return [];
  return db.query<OpenRec>(
    `select id, symbol, horizon, created_at, expires_at, direction, entry, stop, target, cost_rate from recommendations
     where status = 'open' and direction is not null and entry is not null and stop is not null and target is not null`,
  );
}

export async function closeRecommendation(id: string, status: "target-hit" | "stop-hit" | "expired", returnPct: number, at: Date, dbIn?: Db | null) {
  const db = dbIn === undefined ? await getDb() : dbIn;
  if (!db) return;
  await db.query(`update recommendations set status = $2, outcome_return_pct = $3, outcome_at = $4, updated_at = now() where id = $1`, [id, status, returnPct, at.toISOString()]);
  await db.query(`insert into audit_log (actor, action, detail) values ('evaluator', 'outcome', $1::jsonb)`, [JSON.stringify({ id, status, returnPct })]);
}
