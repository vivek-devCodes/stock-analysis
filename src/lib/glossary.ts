// Stock-market glossary (26 sections): terms, full forms, meanings and formulas.
// Data lives in src/lib/glossary-data/*; this module is safe to import on client and server.
import type { GlossarySection, GlossaryTerm } from "./glossary-data/build";
import { PART1 } from "./glossary-data/part1";
import { PART2 } from "./glossary-data/part2";
import { PART3 } from "./glossary-data/part3";
import { PART4 } from "./glossary-data/part4";
import { PART5 } from "./glossary-data/part5";
import { implementationOf } from "./glossary-status";

export type { GlossarySection, GlossaryTerm };

export const GLOSSARY: GlossarySection[] = [...PART1, ...PART2, ...PART3, ...PART4, ...PART5].map((section) => ({
  ...section,
  terms: section.terms.map((t) => {
    const implemented = implementationOf(t, section.number);
    return implemented ? { ...t, implemented } : t;
  }),
}));

/** Top-level chapters (1–21) used for the filter chips. */
export const GLOSSARY_GROUPS: Array<{ number: string; title: string }> = [
  { number: "1", title: "Basics" },
  { number: "2", title: "Analysis types" },
  { number: "3", title: "Financial statements" },
  { number: "4", title: "Financial ratios" },
  { number: "5", title: "Ownership & deals" },
  { number: "6", title: "Technical indicators" },
  { number: "7", title: "Candles & patterns" },
  { number: "8", title: "Futures & options" },
  { number: "9", title: "Intraday" },
  { number: "10", title: "Orders & execution" },
  { number: "11", title: "Risk & portfolio" },
  { number: "12", title: "NSE, BSE & SEBI" },
  { number: "13", title: "Corporate actions" },
  { number: "14", title: "Mutual funds" },
  { number: "15", title: "Macroeconomics" },
  { number: "16", title: "Commodities & FX" },
  { number: "17", title: "Market data & APIs" },
  { number: "18", title: "Business quality" },
  { number: "19", title: "Sentiment" },
  { number: "20", title: "Quant & statistics" },
  { number: "21", title: "Algo trading" },
  { number: "22", title: "Reporting & accounting" },
  { number: "23", title: "Red flags" },
  { number: "24", title: "Abbreviations" },
  { number: "25", title: "Knowledge base" },
  { number: "26", title: "Roadmap" },
];

export const groupOf = (section: GlossarySection) => section.number.split(".")[0];

/** Lowercase and drop everything but letters/digits, so "P/E" = "PE" and "D/E" = "DE". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+\-]/g, "").replace(/-/g, "");

/** Extra spellings the app's UI uses for terms (lookup key → glossary term). */
const ALIASES: Record<string, string> = {
  "P/E": "PE",
  "PE Ratio": "PE",
  "Price to Earnings": "PE",
  "P/B": "PB",
  "Price to Book": "PB",
  "Debt/Equity": "D/E",
  "Debt to Equity": "D/E",
  "Debt/Eq": "D/E",
  "Market Cap": "Market Capitalization",
  "M.Cap": "Market Capitalization",
  "Bollinger": "Bollinger Bands",
  "RVOL": "Relative Volume",
  "Rel. vol": "Relative Volume",
  "Vol ratio": "Relative Volume",
  "Realized Volatility": "Historical Volatility",
  "RV": "Historical Volatility",
  "Stochastic": "Stochastic Oscillator",
  "Put Call Ratio": "PCR",
  "Promoter Holding": "Promoter Holding %",
  "Insider Holding": "Promoter Holding %",
  "Net Profit Margin": "NPM",
  "Operating Margin": "OPM",
  "Reward : risk": "Risk/Reward",
  "Reward/Risk": "Risk/Reward",
  "Div yield": "Dividend Yield",
  "Stop": "Stop Loss",
  "200-DMA": "SMA",
  "50-DMA": "SMA",
  "Moving Average": "MA",
};

let index: Map<string, GlossaryTerm[]> | null = null;

function buildIndex() {
  const map = new Map<string, GlossaryTerm[]>();
  const add = (key: string, t: GlossaryTerm) => {
    const k = norm(key);
    if (!k) return;
    const list = map.get(k) ?? [];
    if (!list.includes(t)) list.push(t);
    map.set(k, list);
  };
  for (const section of GLOSSARY) {
    for (const t of section.terms) {
      add(t.term, t);
      if (t.full) add(t.full, t);
      // "Fundamental Analysis (FA)" also answers to "FA"
      const paren = t.term.match(/\(([^)]+)\)\s*$/);
      if (paren) {
        add(paren[1], t);
        add(t.term.replace(/\s*\([^)]+\)\s*$/, ""), t);
      }
    }
  }
  return map;
}

/**
 * Case-insensitive lookup by term, full form or alias. When a term appears in several
 * sections (EPS, LTP, OI…), the entry that carries a formula wins.
 */
export function findTerm(name: string): GlossaryTerm | undefined {
  index ??= buildIndex();
  const target = ALIASES[name] ?? Object.entries(ALIASES).find(([k]) => norm(k) === norm(name))?.[1] ?? name;
  const hits = index.get(norm(target)) ?? index.get(norm(name));
  if (!hits?.length) return undefined;
  return hits.find((t) => t.formula) ?? hits[0];
}
