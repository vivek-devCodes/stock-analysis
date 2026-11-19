// CRM schema (spec §12). Idempotent: safe to run on every cold start.
// Every analysis is kept as a new version; nothing is overwritten. NO TRADE and rejected results
// are stored too, so performance can be measured without survivorship bias.

export const SCHEMA: string[] = [
  `create table if not exists recommendations (
    id text primary key,
    symbol text not null,
    horizon text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    expires_at timestamptz not null,
    current_version integer not null default 1,
    decision text not null,
    validation text not null,
    score integer,
    direction text,
    entry double precision,
    stop double precision,
    target double precision,
    cost_rate double precision,
    status text not null default 'open',
    outcome_return_pct double precision,
    outcome_at timestamptz
  )`,
  `create index if not exists recommendations_lookup_idx on recommendations (symbol, horizon, created_at desc)`,
  `create index if not exists recommendations_status_idx on recommendations (status)`,
  `create table if not exists recommendation_versions (
    recommendation_id text not null references recommendations(id) on delete cascade,
    version integer not null,
    created_at timestamptz not null default now(),
    data_timestamp timestamptz,
    decision text not null,
    validation text not null,
    score integer,
    report jsonb not null,
    primary key (recommendation_id, version)
  )`,
  `create table if not exists alerts (
    id bigserial primary key,
    recommendation_id text not null references recommendations(id) on delete cascade,
    version integer not null,
    kind text not null,
    channel text not null default 'email',
    status text not null,
    detail text,
    created_at timestamptz not null default now(),
    unique (recommendation_id, version, kind)
  )`,
  `create table if not exists scan_runs (
    id text primary key,
    session text not null,
    run_key text not null unique,
    started_at timestamptz not null,
    finished_at timestamptz not null,
    summary jsonb not null,
    emailed text
  )`,
  `create index if not exists scan_runs_started_idx on scan_runs (started_at desc)`,
  // Paper trading: one simulated intraday trade per symbol per IST day. `data` holds the full trade.
  `create table if not exists paper_trades (
    id text primary key,
    trade_day text not null,
    symbol text not null,
    status text not null default 'open',
    opened_at timestamptz not null,
    data jsonb not null,
    unique (trade_day, symbol)
  )`,
  `create index if not exists paper_trades_day_idx on paper_trades (trade_day desc, opened_at desc)`,
  `create index if not exists paper_trades_status_idx on paper_trades (status)`,
  // One automatic paper-trading run per day (shared by the cron and the page's auto mode).
  `create table if not exists paper_runs (
    run_key text primary key,
    at timestamptz not null default now(),
    summary jsonb
  )`,
  `create table if not exists audit_log (
    id bigserial primary key,
    at timestamptz not null default now(),
    actor text not null,
    action text not null,
    detail jsonb
  )`,
];
