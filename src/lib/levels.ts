import { atrValues, type ChartSignal, type Point } from "./chart-studies";
import type { Candle } from "./types";

/**
 * Price-level toolkit (the tools discretionary chart traders draw by hand), computed automatically so
 * both the chart and the agents use the same levels:
 *   swing points · support / resistance zones · trendlines · Fibonacci retracement & extensions ·
 *   floor-trader and Camarilla pivots · previous-day high / low / close · session VWAP with σ bands ·
 *   volume profile (POC, value area) · market structure (BOS / CHoCH) · fair-value gaps ·
 *   candlestick patterns.
 * Everything is causal on closed candles: a swing point needs `right` later bars to be confirmed.
 */

export type Swing = { index: number; time: number; price: number; kind: "high" | "low" };

export function swingPoints(c: Candle[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < c.length - right; i++) {
    let hi = true;
    let lo = true;
    // Ties: the first of equal highs/lows is the swing (strict on the left, non-strict on the right).
    for (let k = i - left; k <= i + right; k++) {
      if (k === i) continue;
      if (k < i ? c[k].high >= c[i].high : c[k].high > c[i].high) hi = false;
      if (k < i ? c[k].low <= c[i].low : c[k].low < c[i].low) lo = false;
    }
    if (hi) out.push({ index: i, time: c[i].time, price: c[i].high, kind: "high" });
    if (lo) out.push({ index: i, time: c[i].time, price: c[i].low, kind: "low" });
  }
  return out;
}

const lastAtr = (c: Candle[], period = 14) => {
  const a = atrValues(c, period);
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]!;
  const last = c.at(-1);
  return last ? Math.max(last.high - last.low, last.close * 0.005) : 0;
};

/* ------------------------------------------------ S/R zones ------------------------------------------------ */

export type Zone = {
  low: number;
  high: number;
  mid: number;
  touches: number;
  /** Relative to the last close. */
  role: "support" | "resistance";
  lastTime: number;
  strength: number;
};

/**
 * Support / resistance zones: swing highs and lows clustered within ~0.5 ATR, ranked by touches and
 * recency. A zone below the last close is support, above is resistance (flipped levels included).
 */
export function srZones(c: Candle[], opts: { max?: number; left?: number; right?: number; tolAtr?: number } = {}): Zone[] {
  if (c.length < 20) return [];
  const atr = lastAtr(c);
  const tol = Math.max(atr * (opts.tolAtr ?? 0.5), c.at(-1)!.close * 0.002);
  const swings = swingPoints(c, opts.left ?? 3, opts.right ?? 3).sort((a, b) => a.price - b.price);
  const clusters: Swing[][] = [];
  for (const s of swings) {
    const cur = clusters.at(-1);
    if (cur && s.price - cur[0].price <= tol * 2) cur.push(s);
    else clusters.push([s]);
  }
  const last = c.at(-1)!.close;
  const span = c.at(-1)!.time - c[0].time || 1;
  return clusters
    .map((cl) => {
      const prices = cl.map((s) => s.price);
      const low = Math.min(...prices);
      const high = Math.max(...prices);
      const mid = (low + high) / 2;
      const lastTime = Math.max(...cl.map((s) => s.time));
      const recency = (lastTime - c[0].time) / span; // 0 … 1
      return { low, high: Math.max(high, low + tol * 0.3), mid, touches: cl.length, role: mid <= last ? ("support" as const) : ("resistance" as const), lastTime, strength: cl.length + recency * 1.5 };
    })
    .filter((z) => z.touches >= 2 || z.lastTime >= c[Math.max(0, c.length - 40)].time)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, opts.max ?? 6)
    .sort((a, b) => b.mid - a.mid);
}

/** Nearest support below and resistance above the price. */
export function nearestZones(zones: Zone[], price: number): { support: Zone | null; resistance: Zone | null } {
  const support = zones.filter((z) => z.high <= price * 1.001 || (z.low <= price && z.mid < price)).sort((a, b) => b.mid - a.mid)[0] ?? null;
  const resistance = zones.filter((z) => z.low >= price * 0.999 || (z.high >= price && z.mid > price)).sort((a, b) => a.mid - b.mid)[0] ?? null;
  return { support, resistance };
}

/* ------------------------------------------------ trendlines ------------------------------------------------ */

export type Trendline = { kind: "support" | "resistance"; from: Point; to: Point; slopePerBar: number; touches: number; broken: boolean; valueNow: number };

/**
 * The best rising support line through swing lows and falling resistance line through swing highs:
 * a line through two swings that no close has violated in between, scored by extra touches and length.
 */
export function trendlines(c: Candle[], left = 4, right = 4): Trendline[] {
  if (c.length < 30) return [];
  const atr = lastAtr(c);
  const swings = swingPoints(c, left, right);
  const out: Trendline[] = [];
  for (const kind of ["support", "resistance"] as const) {
    const pts = swings.filter((s) => s.kind === (kind === "support" ? "low" : "high")).slice(-8);
    let best: (Trendline & { score: number }) | null = null;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const slope = (b.price - a.price) / (b.index - a.index);
        if (kind === "support" ? slope <= 0 : slope >= 0) continue; // rising support, falling resistance
        const at = (k: number) => a.price + slope * (k - a.index);
        let ok = true;
        for (let k = a.index; k <= b.index && ok; k++) if (kind === "support" ? c[k].close < at(k) - atr * 0.1 : c[k].close > at(k) + atr * 0.1) ok = false;
        if (!ok) continue;
        const touches = pts.filter((p) => p.index >= a.index && Math.abs(p.price - at(p.index)) <= atr * 0.25).length;
        const lastIdx = c.length - 1;
        let broken = false;
        for (let k = b.index + 1; k <= lastIdx; k++) if (kind === "support" ? c[k].close < at(k) - atr * 0.25 : c[k].close > at(k) + atr * 0.25) broken = true;
        const score = touches * 2 + (b.index - a.index) / 20 - (broken ? 3 : 0) + b.index / c.length;
        if (!best || score > best.score) best = { kind, from: { time: a.time, value: a.price }, to: { time: c[lastIdx].time, value: at(lastIdx) }, slopePerBar: slope, touches, broken, valueNow: at(lastIdx), score };
      }
    if (best) {
      const { score: _score, ...line } = best;
      void _score;
      out.push(line);
    }
  }
  return out;
}

/* ------------------------------------------------ Fibonacci ------------------------------------------------ */

export type FibLevel = { ratio: number; price: number; label: string };
export type Fib = { from: Point; to: Point; direction: "up" | "down"; levels: FibLevel[] };

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

/** Retracement of the latest major swing (lowest low ↔ highest high of the lookback), with extensions. */
export function fibRetracement(c: Candle[], lookback = 120): Fib | null {
  const w = c.slice(-lookback);
  if (w.length < 20) return null;
  let hi = 0;
  let lo = 0;
  w.forEach((x, i) => {
    if (x.high > w[hi].high) hi = i;
    if (x.low < w[lo].low) lo = i;
  });
  const up = lo < hi; // swing low came first → the move was up; retracements are measured down from the high
  const start = up ? w[lo].low : w[lo].low;
  const end = up ? w[hi].high : w[hi].high;
  const range = end - start;
  if (!(range > 0)) return null;
  const levels = FIB_RATIOS.map((r) => ({ ratio: r, price: up ? end - range * r : start + range * r, label: r <= 1 ? `${(r * 100).toFixed(1)}%` : `${r} ext` }));
  return { from: up ? { time: w[lo].time, value: start } : { time: w[hi].time, value: end }, to: up ? { time: w[hi].time, value: end } : { time: w[lo].time, value: start }, direction: up ? "up" : "down", levels };
}

/* ------------------------------------------------ pivots & daily levels ------------------------------------------------ */

export type Pivots = { p: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number; camarilla: { r3: number; r4: number; s3: number; s4: number } };

export function pivotPoints(h: number, l: number, cl: number): Pivots {
  const p = (h + l + cl) / 3;
  const r = h - l;
  return {
    p,
    r1: 2 * p - l,
    s1: 2 * p - h,
    r2: p + r,
    s2: p - r,
    r3: h + 2 * (p - l),
    s3: l - 2 * (h - p),
    camarilla: { r3: cl + (r * 1.1) / 4, r4: cl + (r * 1.1) / 2, s3: cl - (r * 1.1) / 4, s4: cl - (r * 1.1) / 2 },
  };
}

const istDay = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

/** Previous session's high / low / close and today's open, from intraday or daily candles. */
export function dailyLevels(c: Candle[]): { pdh: number; pdl: number; pdc: number; todayOpen: number | null; pivots: Pivots } | null {
  if (c.length < 2) return null;
  const byDay = new Map<string, Candle[]>();
  for (const x of c) byDay.set(istDay(x.time), [...(byDay.get(istDay(x.time)) ?? []), x]);
  const days = [...byDay.keys()].sort();
  const daily = days.length >= 2 && byDay.get(days.at(-1)!)!.length > 1; // intraday data
  if (daily) {
    const prev = byDay.get(days.at(-2)!)!;
    const today = byDay.get(days.at(-1)!)!;
    const pdh = Math.max(...prev.map((x) => x.high));
    const pdl = Math.min(...prev.map((x) => x.low));
    const pdc = prev.at(-1)!.close;
    return { pdh, pdl, pdc, todayOpen: today[0].open, pivots: pivotPoints(pdh, pdl, pdc) };
  }
  const prev = c.at(-2)!;
  return { pdh: prev.high, pdl: prev.low, pdc: prev.close, todayOpen: c.at(-1)!.open, pivots: pivotPoints(prev.high, prev.low, prev.close) };
}

/* ------------------------------------------------ VWAP bands & volume profile ------------------------------------------------ */

/** Session VWAP with ±1σ and ±2σ volume-weighted bands (resets each IST day). */
export function vwapBands(c: Candle[]): { vwap: Point[]; up1: Point[]; dn1: Point[]; up2: Point[]; dn2: Point[] } {
  const res = { vwap: [] as Point[], up1: [] as Point[], dn1: [] as Point[], up2: [] as Point[], dn2: [] as Point[] };
  let day = "";
  let pv = 0;
  let v = 0;
  let p2v = 0;
  for (const x of c) {
    const d = istDay(x.time);
    if (d !== day) {
      day = d;
      pv = 0;
      v = 0;
      p2v = 0;
    }
    const tp = (x.high + x.low + x.close) / 3;
    const vol = x.volume || 1;
    pv += tp * vol;
    v += vol;
    p2v += tp * tp * vol;
    const vw = pv / v;
    const sd = Math.sqrt(Math.max(0, p2v / v - vw * vw));
    res.vwap.push({ time: x.time, value: vw });
    res.up1.push({ time: x.time, value: vw + sd });
    res.dn1.push({ time: x.time, value: vw - sd });
    res.up2.push({ time: x.time, value: vw + 2 * sd });
    res.dn2.push({ time: x.time, value: vw - 2 * sd });
  }
  return res;
}

export type VolumeProfile = { poc: number; vah: number; val: number; bins: Array<{ low: number; high: number; volume: number }> };

/** Volume-at-price over the candles: point of control and the 70% value area. */
export function volumeProfile(c: Candle[], binsN = 24): VolumeProfile | null {
  if (c.length < 10) return null;
  const lo = Math.min(...c.map((x) => x.low));
  const hi = Math.max(...c.map((x) => x.high));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / binsN;
  const bins = Array.from({ length: binsN }, (_, i) => ({ low: lo + i * step, high: lo + (i + 1) * step, volume: 0 }));
  for (const x of c) {
    const a = Math.max(0, Math.floor((x.low - lo) / step));
    const b = Math.min(binsN - 1, Math.floor((x.high - lo) / step));
    const share = (x.volume || 1) / (b - a + 1);
    for (let i = a; i <= b; i++) bins[i].volume += share;
  }
  let pocI = 0;
  bins.forEach((b, i) => {
    if (b.volume > bins[pocI].volume) pocI = i;
  });
  const total = bins.reduce((s, b) => s + b.volume, 0);
  let inArea = bins[pocI].volume;
  let up = pocI;
  let dn = pocI;
  while (inArea < total * 0.7 && (up < binsN - 1 || dn > 0)) {
    const nextUp = up < binsN - 1 ? bins[up + 1].volume : -1;
    const nextDn = dn > 0 ? bins[dn - 1].volume : -1;
    if (nextUp >= nextDn) inArea += bins[++up].volume;
    else inArea += bins[--dn].volume;
  }
  return { poc: (bins[pocI].low + bins[pocI].high) / 2, vah: bins[up].high, val: bins[dn].low, bins };
}

/* ------------------------------------------------ market structure, FVGs, patterns ------------------------------------------------ */

export type Structure = { trend: "bullish" | "bearish" | "range"; events: ChartSignal[]; lastHigh: number | null; lastLow: number | null };

/**
 * Market structure from confirmed swings: higher highs + higher lows = bullish, lower highs + lower
 * lows = bearish. A close through the last swing high/low is a Break of Structure (with the trend) or
 * a Change of Character (against it).
 */
export function marketStructure(c: Candle[], left = 3, right = 3): Structure {
  const swings = swingPoints(c, left, right);
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  let trend: Structure["trend"] = "range";
  const h2 = highs.slice(-2);
  const l2 = lows.slice(-2);
  if (h2.length === 2 && l2.length === 2) {
    if (h2[1].price > h2[0].price && l2[1].price > l2[0].price) trend = "bullish";
    else if (h2[1].price < h2[0].price && l2[1].price < l2[0].price) trend = "bearish";
  }
  const events: ChartSignal[] = [];
  let state: "bullish" | "bearish" | "range" = "range";
  let hi: Swing | undefined;
  let lo: Swing | undefined;
  let si = 0;
  const sorted = [...swings].sort((a, b) => a.index - b.index);
  for (let i = 0; i < c.length; i++) {
    while (si < sorted.length && sorted[si].index + right <= i) {
      if (sorted[si].kind === "high") hi = sorted[si];
      else lo = sorted[si];
      si++;
    }
    if (hi && c[i].close > hi.price) {
      events.push({ time: c[i].time, side: "buy", source: "structure", label: state === "bearish" ? "CHoCH" : "BOS", detail: `${state === "bearish" ? "Change of character" : "Break of structure"}: closed above the swing high ${hi.price.toFixed(2)}` } as ChartSignal);
      state = "bullish";
      hi = undefined;
    } else if (lo && c[i].close < lo.price) {
      events.push({ time: c[i].time, side: "sell", source: "structure", label: state === "bullish" ? "CHoCH" : "BOS", detail: `${state === "bullish" ? "Change of character" : "Break of structure"}: closed below the swing low ${lo.price.toFixed(2)}` } as ChartSignal);
      state = "bearish";
      lo = undefined;
    }
  }
  return { trend: trend === "range" && state !== "range" ? state : trend, events: events.slice(-12), lastHigh: highs.at(-1)?.price ?? null, lastLow: lows.at(-1)?.price ?? null };
}

export type Gap = { kind: "bullish" | "bearish"; top: number; bottom: number; time: number; filled: boolean };

/** Three-candle fair-value gaps (imbalances). Only the most recent unfilled ones are kept. */
export function fairValueGaps(c: Candle[], max = 5): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i].low > c[i - 2].high) gaps.push({ kind: "bullish", bottom: c[i - 2].high, top: c[i].low, time: c[i - 1].time, filled: false });
    else if (c[i].high < c[i - 2].low) gaps.push({ kind: "bearish", top: c[i - 2].low, bottom: c[i].high, time: c[i - 1].time, filled: false });
  }
  for (const g of gaps) {
    const after = c.filter((x) => x.time > g.time + 1);
    g.filled = after.slice(1).some((x) => (g.kind === "bullish" ? x.low <= g.bottom : x.high >= g.top));
  }
  return gaps.filter((g) => !g.filled).slice(-max);
}

export type Pattern = { time: number; name: string; side: "buy" | "sell" | "neutral" };

/** Classic candlestick patterns on the candles (engulfing, hammer, shooting star, morning/evening star, doji, inside bar). */
export function candlePatterns(c: Candle[]): Pattern[] {
  const out: Pattern[] = [];
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2];
    const p = c[i - 1];
    const x = c[i];
    const body = Math.abs(x.close - x.open);
    const range = x.high - x.low || 1e-9;
    const upper = x.high - Math.max(x.open, x.close);
    const lower = Math.min(x.open, x.close) - x.low;
    const pBody = Math.abs(p.close - p.open);
    const downBefore = p.close < a.close;
    const upBefore = p.close > a.close;
    if (p.close < p.open && x.close > x.open && x.close >= p.open && x.open <= p.close && body > pBody) out.push({ time: x.time, name: "Bullish engulfing", side: "buy" });
    else if (p.close > p.open && x.close < x.open && x.open >= p.close && x.close <= p.open && body > pBody) out.push({ time: x.time, name: "Bearish engulfing", side: "sell" });
    else if (lower >= 2 * body && upper <= body * 0.6 && body / range < 0.4 && downBefore) out.push({ time: x.time, name: "Hammer", side: "buy" });
    else if (upper >= 2 * body && lower <= body * 0.6 && body / range < 0.4 && upBefore) out.push({ time: x.time, name: "Shooting star", side: "sell" });
    else if (a.close < a.open && Math.abs(p.close - p.open) < Math.abs(a.close - a.open) * 0.35 && x.close > x.open && x.close > (a.open + a.close) / 2) out.push({ time: x.time, name: "Morning star", side: "buy" });
    else if (a.close > a.open && Math.abs(p.close - p.open) < Math.abs(a.close - a.open) * 0.35 && x.close < x.open && x.close < (a.open + a.close) / 2) out.push({ time: x.time, name: "Evening star", side: "sell" });
    else if (body / range < 0.1) out.push({ time: x.time, name: "Doji", side: "neutral" });
    else if (x.high < p.high && x.low > p.low) out.push({ time: x.time, name: "Inside bar", side: "neutral" });
  }
  return out;
}

/* ------------------------------------------------ summary for the agents ------------------------------------------------ */

export type LevelContext = {
  price: number;
  atr: number;
  support: Zone | null;
  resistance: Zone | null;
  /** Distance to the nearest zones in ATRs. */
  toSupportAtr: number | null;
  toResistanceAtr: number | null;
  structure: Structure["trend"];
  lastEvent: string | null;
  trendlines: Trendline[];
  fib: Fib | null;
  /** Fib level the price is sitting on (within 0.25 ATR), if any. */
  atFib: string | null;
  poc: number | null;
  valueArea: { low: number; high: number } | null;
  pattern: Pattern | null;
  openGaps: Gap[];
  notes: string[];
};

/** Everything the technical and risk agents need about levels, in one pass. */
export function levelContext(c: Candle[]): LevelContext | null {
  if (c.length < 30) return null;
  const price = c.at(-1)!.close;
  const atr = lastAtr(c);
  const zones = srZones(c);
  const { support, resistance } = nearestZones(zones, price);
  const st = marketStructure(c);
  const tl = trendlines(c);
  const fib = fibRetracement(c);
  const vp = volumeProfile(c.slice(-120));
  const pats = candlePatterns(c.slice(-3)).filter((p) => p.time === c.at(-1)!.time);
  const gaps = fairValueGaps(c.slice(-150));
  const atFibLevel = fib?.levels.find((l) => l.ratio > 0 && l.ratio < 1 && Math.abs(l.price - price) <= atr * 0.25) ?? null;
  const toS = support ? (price - support.high) / atr : null;
  const toR = resistance ? (resistance.low - price) / atr : null;
  const notes: string[] = [];
  if (support) notes.push(`Support ${support.low.toFixed(2)}–${support.high.toFixed(2)} (${support.touches} touches, ${Math.max(0, toS ?? 0).toFixed(1)} ATR below)`);
  if (resistance) notes.push(`Resistance ${resistance.low.toFixed(2)}–${resistance.high.toFixed(2)} (${resistance.touches} touches, ${Math.max(0, toR ?? 0).toFixed(1)} ATR above)`);
  notes.push(`Structure ${st.trend}${st.events.at(-1) ? ` — last ${st.events.at(-1)!.label} ${st.events.at(-1)!.side === "buy" ? "up" : "down"}` : ""}`);
  for (const t of tl) notes.push(`${t.kind === "support" ? "Rising support" : "Falling resistance"} trendline at ${t.valueNow.toFixed(2)} (${t.touches} touches${t.broken ? ", broken" : ""})`);
  if (atFibLevel) notes.push(`At the ${atFibLevel.label} Fibonacci retracement (${atFibLevel.price.toFixed(2)})`);
  if (vp) notes.push(`Volume POC ${vp.poc.toFixed(2)}; value area ${vp.val.toFixed(2)}–${vp.vah.toFixed(2)} (price ${price > vp.vah ? "above" : price < vp.val ? "below" : "inside"})`);
  if (pats[0]) notes.push(`Last candle: ${pats[0].name}`);
  return {
    price,
    atr,
    support,
    resistance,
    toSupportAtr: toS,
    toResistanceAtr: toR,
    structure: st.trend,
    lastEvent: st.events.at(-1) ? `${st.events.at(-1)!.label} ${st.events.at(-1)!.side === "buy" ? "up" : "down"}` : null,
    trendlines: tl,
    fib,
    atFib: atFibLevel?.label ?? null,
    poc: vp?.poc ?? null,
    valueArea: vp ? { low: vp.val, high: vp.vah } : null,
    pattern: pats[0] ?? null,
    openGaps: gaps,
    notes,
  };
}

/**
 * Level-aware adjustment for a directional idea: room to the next opposing zone, confirmation from
 * structure / patterns / zones, and a stop and target placed beyond and before real levels.
 */
export function levelAssessment(ctx: LevelContext, side: "long" | "short"): { scoreAdj: number; reasons: string[]; stop: number | null; target: number | null } {
  const reasons: string[] = [];
  let adj = 0;
  const long = side === "long";
  const room = long ? ctx.toResistanceAtr : ctx.toSupportAtr;
  const cushion = long ? ctx.toSupportAtr : ctx.toResistanceAtr;
  if (room != null && room < 0.5) {
    adj -= 12;
    reasons.push(`Only ${room.toFixed(1)} ATR to ${long ? "resistance" : "support"} — little room to the target`);
  } else if (room != null && room >= 2) {
    adj += 4;
    reasons.push(`${room.toFixed(1)} ATR of room to the next ${long ? "resistance" : "support"}`);
  }
  if (cushion != null && cushion <= 0.6) {
    adj += 6;
    reasons.push(`Entering near ${long ? "support" : "resistance"} (${cushion.toFixed(1)} ATR) — tight, well-defined risk`);
  }
  if ((long && ctx.structure === "bullish") || (!long && ctx.structure === "bearish")) {
    adj += 6;
    reasons.push(`Market structure is ${ctx.structure}`);
  } else if ((long && ctx.structure === "bearish") || (!long && ctx.structure === "bullish")) {
    adj -= 8;
    reasons.push(`Against the ${ctx.structure} market structure`);
  }
  if (ctx.pattern && ctx.pattern.side !== "neutral") {
    const agrees = (ctx.pattern.side === "buy") === long;
    adj += agrees ? 5 : -5;
    reasons.push(`${ctx.pattern.name} on the last candle ${agrees ? "confirms" : "contradicts"} the idea`);
  }
  const zone = long ? ctx.support : ctx.resistance;
  const opposing = long ? ctx.resistance : ctx.support;
  const stop = zone ? (long ? zone.low - ctx.atr * 0.25 : zone.high + ctx.atr * 0.25) : null;
  const target = opposing ? (long ? opposing.low - ctx.atr * 0.1 : opposing.high + ctx.atr * 0.1) : null;
  return { scoreAdj: Math.max(-20, Math.min(15, adj)), reasons, stop, target };
}
