import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "Stock Analyzer — Apex Desk" };

const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.\-=&^]{0,19}$/i;

async function AnalyzerFromParams({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).symbol;
  const symbol = typeof raw === "string" && SYMBOL_RE.test(raw) ? raw.toUpperCase() : "RELIANCE.NS";
  return <Dashboard key={symbol} initialSymbol={symbol} />;
}

export default function AnalyzePage(props: PageProps<"/analyze">) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading analyzer…</div>}>
      <AnalyzerFromParams searchParams={props.searchParams} />
    </Suspense>
  );
}
