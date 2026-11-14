import Link from "next/link";
import { ArrowRight, LayoutDashboard, Zap } from "lucide-react";
import { HeadlinesWidget, MarketKpis, TopStocksWidget, WatchlistWidget } from "@/components/overview/OverviewWidgets";
import { Card, PageHeader } from "@/components/shell/PageHeader";
import { NAV_GROUPS } from "@/lib/nav";

const DESKS = NAV_GROUPS.flatMap((g) => (g.title === "Overview" ? [] : g.items));

export default function OverviewPage() {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader icon={LayoutDashboard} title="Market overview" subtitle="Your stock-analysis workspace — live markets, picks and news at a glance." />

      <MarketKpis />

      <Card icon={Zap} tone="text-warn" title="Quick access">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {DESKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] p-3 transition-colors hover:border-white/20 hover:bg-white/[0.04]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <Icon className={`h-[18px] w-[18px] ${item.tone}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 font-mono text-sm font-semibold">
                    [ {item.label} ]
                    <ArrowRight className="h-3.5 w-3.5 text-muted transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <WatchlistWidget />
        <TopStocksWidget />
        <HeadlinesWidget />
      </div>
    </div>
  );
}
