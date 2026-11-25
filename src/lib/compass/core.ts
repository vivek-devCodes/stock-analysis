/**
 * Market Compass — the 9 AM pre-market checklist as one opening-bias score.
 *
 *   1. US close (Dow Jones, Nasdaq, S&P 500): green close → better odds of a positive Indian open.
 *   2. US futures and Asia (Nikkei, Hang Seng) overnight / this morning.
 *   3. GIFT Nifty (formerly SGX Nifty): its premium over NIFTY's last close is the market's own
 *      forecast of the gap.
 *   4. NIFTY advance / decline: the 09:00–09:08 pre-open session when available, otherwise the
 *      previous session's breadth.
 *   5. India VIX: above 15 → volatile session (wider ranges); below 15 → calmer / range-bound.
 *
 * Pure: the inputs are fetched in fetch.ts. Every check reports its own reading so the trader sees
 * the evidence, and the compass's accuracy is measured against the actual open each day.
 */

export type CompassInputs = {
  asOf: string;
  us: { dow: number | null; nasdaq: number | null; sp: number | null; closedAt: string | null };
  usFutures: { dow: number | null; nasdaq: number | null };
  asia: { nikkei: number | null; hangSeng: number | null };
  /** GIFT Nifty near-month future; `expiry` (YYYY-MM-DD) is used to remove its normal premium (cost of carry). */
  gift: { price: number; changePct: number | null; at: string | null; expiry: string | null } | null;
  niftyClose: number | null;
  /** 09:00–09:08 pre-open: advances / declines among NIFTY 50 and the index's indicative change. */
  preOpen: { advances: number; declines: number; indexChangePct: number | null } | null;
  /** Previous session's NSE breadth (fallback before the pre-open session). */
  prevBreadth: { advances: number; declines: number } | null;
  vix: { level: number; changePct: number | null } | null;
};

export type CheckTone = "bullish" | "bearish" | "neutral" | "missing";
export type CompassCheck = { id: string; label: string; reading: string; tone: CheckTone; weight: number; signal: number | null };

export type Compass = {
  asOf: string;
  score: number | null;
  bias: "gap-up" | "positive" | "flat" | "negative" | "gap-down" | "unknown";
  biasText: string;
  expectedGapPct: number | null;
  volatility: "volatile" | "calm" | "unknown";
  volatilityText: string;
  playbook: string[];
  checks: CompassCheck[];
  /** Share of the total weight that had data (0–1). */
  coverage: number;
};

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const pct = (x: number | null, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const toneOf = (s: number | null, dead = 0.15): CheckTone => (s == null ? "missing" : s > dead ? "bullish" : s < -dead ? "bearish" : "neutral");
const avg = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Weights: GIFT Nifty and the pre-open session see India directly; global cues are indirect. */
export const COMPASS_WEIGHTS = { gift: 35, preOpen: 25, usClose: 20, usFutures: 10, asia: 10, prevBreadth: 8 } as const;
export const VIX_LINE = 15;
/** Futures trade above the index by the cost of carry: ≈ interest − dividend yield, per year. */
export const CARRY_RATE = 0.052;

/** Fair premium (%) of a NIFTY future over the index with `days` to expiry. */
export const fairPremiumPct = (days: number) => CARRY_RATE * Math.max(0, days) / 365 * 100;

export function buildCompass(x: CompassInputs): Compass {
  const checks: CompassCheck[] = [];

  // 1. US close: average of Dow and Nasdaq (S&P as a tie-breaker), ±1% = full signal.
  const usAvg = avg([x.us.dow, x.us.nasdaq]);
  const usSig = usAvg == null ? null : clamp(usAvg / 1);
  checks.push({ id: "us-close", label: "US close — Dow Jones / Nasdaq", reading: `Dow ${pct(x.us.dow)} · Nasdaq ${pct(x.us.nasdaq)} · S&P ${pct(x.us.sp)}`, tone: toneOf(usSig), weight: COMPASS_WEIGHTS.usClose, signal: usSig });

  // 2a. US futures overnight, ±0.6% = full signal.
  const futAvg = avg([x.usFutures.dow, x.usFutures.nasdaq]);
  const futSig = futAvg == null ? null : clamp(futAvg / 0.6);
  checks.push({ id: "us-futures", label: "US futures (now)", reading: `Dow fut ${pct(x.usFutures.dow)} · Nasdaq fut ${pct(x.usFutures.nasdaq)}`, tone: toneOf(futSig), weight: COMPASS_WEIGHTS.usFutures, signal: futSig });

  // 2b. Asia this morning, ±1% = full signal.
  const asiaAvg = avg([x.asia.nikkei, x.asia.hangSeng]);
  const asiaSig = asiaAvg == null ? null : clamp(asiaAvg / 1);
  checks.push({ id: "asia", label: "Asia — Nikkei / Hang Seng", reading: `Nikkei ${pct(x.asia.nikkei)} · Hang Seng ${pct(x.asia.hangSeng)}`, tone: toneOf(asiaSig), weight: COMPASS_WEIGHTS.asia, signal: asiaSig });

  // 3. GIFT Nifty vs NIFTY's last close, after removing the future's normal premium (cost of carry):
  //    what is left is the market's forecast of the gap. ±0.5% = full signal.
  const raw = x.gift && x.niftyClose ? ((x.gift.price - x.niftyClose) / x.niftyClose) * 100 : null;
  const days = x.gift?.expiry ? (Date.parse(`${x.gift.expiry}T15:30:00+05:30`) - Date.parse(x.asOf)) / 86400_000 : 15;
  const carry = fairPremiumPct(days);
  const premium = raw == null ? null : raw - carry;
  const giftSig = premium == null ? null : clamp(premium / 0.5);
  checks.push({
    id: "gift",
    label: "GIFT Nifty (SGX Nifty) vs NIFTY close",
    reading: x.gift ? `${x.gift.price.toFixed(1)} vs ${x.niftyClose?.toFixed(1) ?? "—"}: ${pct(raw)} raw − ${carry.toFixed(2)}% carry → ${pct(premium)}${x.gift.changePct != null ? ` (session ${pct(x.gift.changePct)})` : ""}` : "unavailable",
    tone: toneOf(giftSig, 0.1),
    weight: COMPASS_WEIGHTS.gift,
    signal: giftSig,
  });

  // 4. Advance / decline: pre-open if available, else yesterday's breadth (lower weight).
  if (x.preOpen && x.preOpen.advances + x.preOpen.declines > 0) {
    const r = (x.preOpen.advances - x.preOpen.declines) / (x.preOpen.advances + x.preOpen.declines);
    const idx = x.preOpen.indexChangePct != null ? clamp(x.preOpen.indexChangePct / 0.5) : null;
    const sig = idx != null ? clamp(0.6 * r * 1.5 + 0.4 * idx) : clamp(r * 1.5);
    checks.push({ id: "pre-open", label: "NIFTY pre-open advance / decline (09:00–09:08)", reading: `${x.preOpen.advances} up · ${x.preOpen.declines} down${x.preOpen.indexChangePct != null ? ` · NIFTY indicative ${pct(x.preOpen.indexChangePct)}` : ""}`, tone: toneOf(sig), weight: COMPASS_WEIGHTS.preOpen, signal: sig });
  } else if (x.prevBreadth && x.prevBreadth.advances + x.prevBreadth.declines > 0) {
    const r = (x.prevBreadth.advances - x.prevBreadth.declines) / (x.prevBreadth.advances + x.prevBreadth.declines);
    const sig = clamp(r * 1.5);
    checks.push({ id: "breadth", label: "Advance / decline — previous session (pre-open not started)", reading: `${x.prevBreadth.advances} advances · ${x.prevBreadth.declines} declines`, tone: toneOf(sig), weight: COMPASS_WEIGHTS.prevBreadth, signal: sig });
  } else {
    checks.push({ id: "pre-open", label: "NIFTY advance / decline", reading: "unavailable", tone: "missing", weight: COMPASS_WEIGHTS.preOpen, signal: null });
  }

  // 5. India VIX: not directional — it sets the volatility regime.
  const vix = x.vix?.level ?? null;
  checks.push({
    id: "vix",
    label: "India VIX (volatility)",
    reading: vix == null ? "unavailable" : `${vix.toFixed(2)}${x.vix?.changePct != null ? ` (${pct(x.vix.changePct, 1)})` : ""} — ${vix >= VIX_LINE ? `above ${VIX_LINE}: volatile` : `below ${VIX_LINE}: calm`}`,
    tone: vix == null ? "missing" : "neutral",
    weight: 0,
    signal: null,
  });

  const used = checks.filter((c) => c.signal != null && c.weight > 0);
  const totalW = checks.reduce((s, c) => s + c.weight, 0);
  const usedW = used.reduce((s, c) => s + c.weight, 0);
  const score = usedW > 0 ? Math.round((used.reduce((s, c) => s + c.weight * c.signal!, 0) / usedW) * 100) : null;
  const bias: Compass["bias"] = score == null ? "unknown" : score >= 50 ? "gap-up" : score >= 20 ? "positive" : score <= -50 ? "gap-down" : score <= -20 ? "negative" : "flat";
  const BIAS_TEXT: Record<Compass["bias"], string> = {
    "gap-up": "Gap-up open likely",
    positive: "Positive open likely",
    flat: "Flat / mixed open",
    negative: "Negative open likely",
    "gap-down": "Gap-down open likely",
    unknown: "Not enough data",
  };
  const volatility: Compass["volatility"] = vix == null ? "unknown" : vix >= VIX_LINE ? "volatile" : "calm";
  const rising = (x.vix?.changePct ?? 0) >= 5;
  const volatilityText = vix == null ? "India VIX unavailable" : volatility === "volatile" ? `VIX ${vix.toFixed(1)} ≥ ${VIX_LINE}: bigger swings — wider stops, smaller size${rising ? "; VIX rising fast" : ""}` : `VIX ${vix.toFixed(1)} < ${VIX_LINE}: calmer session — ranges and sideways moves more likely${rising ? " (but VIX is rising)" : ""}`;

  const playbook: string[] = [];
  if (bias === "gap-up" || bias === "positive") playbook.push(volatility === "volatile" ? "Positive cues but a volatile tape: let the first 15–30 minutes settle, then buy the opening-range breakout — avoid chasing the gap." : "Positive cues in a calm market: favour longs on dips to VWAP / support after the open.");
  if (bias === "gap-down" || bias === "negative") playbook.push(volatility === "volatile" ? "Negative cues and high volatility: no fresh longs in the first half hour; shorts only on a break of the opening-range low." : "Negative cues: avoid fresh longs at the open; wait for the market to find support.");
  if (bias === "flat") playbook.push(volatility === "calm" ? "Mixed cues and low VIX: range-bound day likely — trade support/resistance, not breakouts." : "Mixed cues but high VIX: wait for direction from the opening range.");
  if (bias === "gap-up" || bias === "gap-down") playbook.push("Large gaps often partly fill in the first hour — don't enter at the open print.");
  return { asOf: x.asOf, score, bias, biasText: BIAS_TEXT[bias], expectedGapPct: premium, volatility, volatilityText, playbook, checks, coverage: totalW ? usedW / totalW : 0 };
}

/** Is the compass for or against a trade direction? Strength 0–1 (0 when flat or unknown). */
export function compassAgainst(c: Compass | null, side: "long" | "short"): number {
  if (!c || c.score == null) return 0;
  const s = side === "long" ? -c.score : c.score;
  return s <= 20 ? 0 : Math.min(1, (s - 20) / 60);
}

/* ------------------------------------------ accuracy ------------------------------------------ */

export type CompassOutcome = { day: string; score: number; predicted: "up" | "down" | "flat"; gapPct: number; dayPct: number; gapRight: boolean | null; dayRight: boolean | null };

/** Was the compass right about the open (gap) and about the day (close vs previous close)? */
export function grade(day: string, score: number, prevClose: number, open: number, close: number): CompassOutcome {
  const predicted = score >= 20 ? "up" : score <= -20 ? "down" : "flat";
  const gapPct = ((open - prevClose) / prevClose) * 100;
  const dayPct = ((close - prevClose) / prevClose) * 100;
  const dir = (x: number, dead: number) => (x > dead ? "up" : x < -dead ? "down" : "flat");
  return {
    day,
    score,
    predicted,
    gapPct,
    dayPct,
    gapRight: predicted === "flat" ? null : dir(gapPct, 0.1) === predicted,
    dayRight: predicted === "flat" ? null : dir(dayPct, 0.15) === predicted,
  };
}

export function accuracy(outcomes: CompassOutcome[]) {
  const g = outcomes.filter((o) => o.gapRight != null);
  const d = outcomes.filter((o) => o.dayRight != null);
  return {
    days: outcomes.length,
    calls: g.length,
    gapHit: g.length ? g.filter((o) => o.gapRight).length / g.length : null,
    dayHit: d.length ? d.filter((o) => o.dayRight).length / d.length : null,
  };
}
