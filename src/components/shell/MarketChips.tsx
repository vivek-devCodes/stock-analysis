"use client";

import Link from "next/link";
import { clsx, formatPercent } from "@/lib/format";
import { LiveBadge } from "../LiveBadge";
import { INDEX_LABELS, useMarket } from "./market-store";

const TOPBAR = ["^NSEI", "^BSESN", "^NSEBANK"];

/** Compact live index chips for the top bar (wide screens only). */
export function MarketChips() {
  const { quotes } = useMarket();
  const shown = TOPBAR.flatMap((s) => quotes.filter((q) => q.symbol === s));
  if (!shown.length) return null;
  return (
    <div className="hidden items-center gap-2 xl:flex">
      {shown.map((q) => (
        <Link
          key={q.symbol}
          href={`/analyze?symbol=${encodeURIComponent(q.symbol)}`}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs hover:bg-white/5"
        >
          <LiveBadge quote={q} compact />
          <span className="text-muted">{INDEX_LABELS[q.symbol]}</span>
          <span className="font-mono">{q.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          <span className={clsx(q.changePercent >= 0 ? "text-up" : "text-down")}>{formatPercent(q.changePercent)}</span>
        </Link>
      ))}
    </div>
  );
}
