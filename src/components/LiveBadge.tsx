import { clsx } from "@/lib/format";
import type { LiveQuote } from "@/lib/types";

/** Green pulsing = live/≤1-min feed while the market is open; amber = delayed; grey = market closed. */
export function LiveBadge({ quote, compact = false }: { quote: LiveQuote; compact?: boolean }) {
  const open = quote.marketState === "REGULAR";
  const live = open && quote.delayMinutes <= 1;
  const label = !open ? "Closed" : live ? "Live" : `${quote.delayMinutes}m delay`;
  const title = `${quote.source} · ${open ? "market open" : "market closed"} · last update ${new Date(quote.time * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`;
  const dot = (
    <span className="relative flex h-2 w-2">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />}
      <span className={clsx("relative inline-flex h-2 w-2 rounded-full", live ? "bg-up" : open ? "bg-warn" : "bg-muted")} />
    </span>
  );
  if (compact) {
    return (
      <span title={title} aria-label={label} className="flex items-center">
        {dot}
      </span>
    );
  }
  return (
    <span
      title={title}
      className={clsx(
        "chip inline-flex items-center gap-1.5",
        live ? "bg-up/15 text-up" : open ? "bg-warn/15 text-warn" : "bg-white/8 text-muted",
      )}
    >
      {dot}
      {label}
    </span>
  );
}
