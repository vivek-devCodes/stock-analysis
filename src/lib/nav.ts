import {
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  CandlestickChart,
  Clock,
  Filter,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Landmark,
  LineChart,
  Newspaper,
  PieChart,
  Repeat,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown under the page title in the top bar. */
  description: string;
  /** Tailwind text colour for the icon accent. */
  tone: string;
};

export const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, description: "Market snapshot, top picks and latest headlines", tone: "text-accent" },
    ],
  },
  {
    title: "Trading desks",
    items: [
      { href: "/dashboard/intraday", label: "Intraday", icon: Clock, description: "Same-day setups from 15-minute candles", tone: "text-warn" },
      { href: "/dashboard/short-term", label: "Short Term", icon: LineChart, description: "1–2 week swing trades", tone: "text-accent" },
      { href: "/dashboard/long-term", label: "Long Term", icon: Landmark, description: "3–12 month positional ideas", tone: "text-up" },
      { href: "/dashboard/options", label: "Options", icon: Repeat, description: "CALL / PUT direction with ATM strike", tone: "text-[#b18cff]" },
      { href: "/paper-trading", label: "Paper Trading", icon: FlaskConical, description: "The AI agent's intraday calls, traded on paper and scored automatically", tone: "text-[#fb923c]" },
      { href: "/scorecard", label: "Scorecard", icon: Gauge, description: "Which signals, agents and scores really work — vs baselines, fed back into the agent", tone: "text-[#22d3ee]" },
      { href: "/portfolio", label: "Portfolio", icon: Briefcase, description: "Momentum + quality basket, rebalanced monthly, measured against NIFTY 50", tone: "text-[#34d399]" },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/agent", label: "AI Analyst", icon: Bot, description: "Multi-agent analysis: evidence, risk check and independent validation", tone: "text-[#a78bfa]" },
      { href: "/market-data", label: "NSE Market Data", icon: Building2, description: "Official NSE/BSE files: breadth, FII positioning, option chain, OI, delivery, deals, surveillance", tone: "text-[#60a5fa]" },
      { href: "/sectors", label: "Sectors", icon: PieChart, description: "Sector strength, buying/selling pressure and stock returns", tone: "text-[#34d399]" },
      { href: "/screener", label: "Stock Screener", icon: Filter, description: "Fundamentals: quality, growth and value", tone: "text-[#4fd1c5]" },
      { href: "/news", label: "Market News", icon: Newspaper, description: "Headlines from Indian financial media", tone: "text-[#f472b6]" },
      { href: "/glossary", label: "Glossary", icon: BookOpen, description: "Stock-market terms, formulas and definitions", tone: "text-[#fbbf24]" },
      { href: "/analyze", label: "Stock Analyzer", icon: CandlestickChart, description: "Live chart, indicators, expected range, watchlist and alerts", tone: "text-foreground" },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function navItemFor(pathname: string): NavItem {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.filter((i) => i.href !== "/" && pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0] ?? NAV_ITEMS[0];
}
