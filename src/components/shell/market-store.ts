"use client";

import { useSyncExternalStore } from "react";
import type { LiveQuote } from "@/lib/types";

/**
 * One shared poller for /api/market (every 10 s while the tab is visible), so the top bar,
 * the overview cards and the analyzer all read the same quotes without polling separately.
 */

type MarketState = { quotes: LiveQuote[]; asOf: string | null };

const POLL_MS = 10_000;
let state: MarketState = { quotes: [], asOf: null };
const listeners = new Set<() => void>();
let timer: number | null = null;

async function tick() {
  if (document.visibilityState !== "visible") return;
  try {
    const res = await fetch("/api/market");
    if (!res.ok) return;
    const json = await res.json();
    if (Array.isArray(json.indices)) {
      state = { quotes: json.indices, asOf: json.asOf ?? null };
      listeners.forEach((l) => l());
    }
  } catch {
    // network blip: keep the last snapshot
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void tick();
    timer = window.setInterval(tick, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

const EMPTY: MarketState = { quotes: [], asOf: null };

export function useMarket(): MarketState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export const INDEX_LABELS: Record<string, string> = {
  "^NSEI": "Nifty 50",
  "^BSESN": "Sensex",
  "^NSEBANK": "Bank Nifty",
  "^GSPC": "S&P 500",
  "^IXIC": "Nasdaq",
  "^DJI": "Dow",
  "BTC-USD": "Bitcoin",
};
