// Black–Scholes pricing, implied volatility and Greeks for European options (NSE stock and index
// options are European-style and cash-settled). Pure; covered by src/scripts/test-exchange.ts.

import type { Greeks } from "./types";

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

const normPdf = (x: number) => 0.3989422804014327 * Math.exp((-x * x) / 2);

export type OptionInput = { spot: number; strike: number; years: number; rate: number; type: "CE" | "PE" };

export function bsPrice(o: OptionInput, vol: number): number {
  const { spot: S, strike: K, years: T, rate: r } = o;
  if (T <= 0 || vol <= 0) return Math.max(0, o.type === "CE" ? S - K : K - S);
  const sq = vol * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (vol * vol) / 2) * T) / sq;
  const d2 = d1 - sq;
  const df = Math.exp(-r * T);
  return o.type === "CE" ? S * normCdf(d1) - K * df * normCdf(d2) : K * df * normCdf(-d2) - S * normCdf(-d1);
}

/** Implied volatility by bisection; null when the price is below intrinsic value or unusable. */
export function impliedVol(o: OptionInput, price: number): number | null {
  if (!(price > 0) || !(o.spot > 0) || !(o.strike > 0) || !(o.years > 0)) return null;
  const intrinsic = Math.max(0, o.type === "CE" ? o.spot - o.strike * Math.exp(-o.rate * o.years) : o.strike * Math.exp(-o.rate * o.years) - o.spot);
  if (price <= intrinsic + 1e-9) return null;
  let lo = 0.005;
  let hi = 5;
  if (bsPrice(o, hi) < price) return null;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (bsPrice(o, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function greeks(o: OptionInput, price: number): Greeks | null {
  const iv = impliedVol(o, price);
  if (iv == null) return null;
  const { spot: S, strike: K, years: T, rate: r } = o;
  const sq = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (iv * iv) / 2) * T) / sq;
  const d2 = d1 - sq;
  const df = Math.exp(-r * T);
  const common = (-S * normPdf(d1) * iv) / (2 * Math.sqrt(T));
  return {
    price,
    iv,
    delta: o.type === "CE" ? normCdf(d1) : normCdf(d1) - 1,
    gamma: normPdf(d1) / (S * sq),
    theta: (o.type === "CE" ? common - r * K * df * normCdf(d2) : common + r * K * df * normCdf(-d2)) / 365,
    vega: (S * normPdf(d1) * Math.sqrt(T)) / 100,
  };
}
