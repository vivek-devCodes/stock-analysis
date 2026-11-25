"use client";

import { Minus, MousePointer2, Spline, Trash2, TrendingUp, Undo2 } from "lucide-react";
import { clsx } from "@/lib/format";

export type DrawTool = "none" | "hline" | "trend" | "fib";
export type Drawing = { id: string; kind: Exclude<DrawTool, "none">; a: { time: number; price: number }; b?: { time: number; price: number } };

const KEY = (symbol: string) => `apex-drawings:${symbol}`;

/** Drawings are saved per symbol in this browser. */
export function loadDrawings(symbol: string): Drawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY(symbol));
    return raw ? (JSON.parse(raw) as Drawing[]) : [];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, items: Drawing[]) {
  try {
    localStorage.setItem(KEY(symbol), JSON.stringify(items));
  } catch {
    /* storage full or blocked: drawings stay for this view only */
  }
}

const TOOLS: Array<{ id: DrawTool; label: string; icon: typeof Minus; hint: string }> = [
  { id: "none", label: "Cursor", icon: MousePointer2, hint: "Pan and zoom" },
  { id: "hline", label: "Horizontal line", icon: Minus, hint: "One click: a price level" },
  { id: "trend", label: "Trendline", icon: TrendingUp, hint: "Two clicks: a line extended to the latest candle" },
  { id: "fib", label: "Fib retracement", icon: Spline, hint: "Two clicks: swing start, then swing end" },
];

export function DrawingToolbar({ tool, onTool, count, hint, onClear, onUndo }: { tool: DrawTool; onTool: (t: DrawTool) => void; count: number; hint: string | null; onClear: () => void; onUndo: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Draw</span>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={`${t.label} — ${t.hint}`}
          aria-pressed={tool === t.id}
          onClick={() => onTool(t.id)}
          className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-1", tool === t.id ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground")}
        >
          <t.icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.label}</span>
        </button>
      ))}
      {count > 0 && (
        <>
          <button onClick={onUndo} title="Remove the last drawing" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-muted hover:text-foreground">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button onClick={onClear} title="Remove all drawings on this stock" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-muted hover:text-down">
            <Trash2 className="h-3.5 w-3.5" /> Clear ({count})
          </button>
        </>
      )}
      {hint && <span className="ml-1 text-accent">{hint}</span>}
    </div>
  );
}
