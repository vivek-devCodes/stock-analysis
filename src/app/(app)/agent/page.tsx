import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentAnalyst } from "@/components/agent/AgentAnalyst";
import { HORIZONS, type Horizon } from "@/lib/agents/types";

export const metadata: Metadata = { title: "AI Analyst — Apex Desk" };

const SYMBOL_RE = /^[A-Za-z0-9^][A-Za-z0-9.\-=&^]{0,24}$/;

/** /agent?symbol=TCS.NS&horizon=swing prefills the form and runs the analysis once. */
async function AgentWithParams({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const symbol = typeof sp.symbol === "string" && SYMBOL_RE.test(sp.symbol) ? sp.symbol.toUpperCase() : "";
  const horizon = (HORIZONS.find((h) => h.id === sp.horizon)?.id ?? "swing") as Horizon;
  return <AgentAnalyst key={`${symbol}|${horizon}`} initialSymbol={symbol} initialHorizon={horizon} autoRun={Boolean(symbol)} />;
}

export default function AgentPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<AgentAnalyst />}>
      <AgentWithParams searchParams={props.searchParams} />
    </Suspense>
  );
}
