"use client";

import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";

/** Top-bar search: type a company or ticker, pick a result, open it in the Stock Analyzer. */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) window.clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const json = await res.json();
        setResults((json.results ?? []).slice(0, 8));
      } finally {
        setLoading(false);
      }
    }, 220);
  };

  const open = (symbol: string) => {
    setQuery("");
    setResults([]);
    router.push(`/analyze?symbol=${encodeURIComponent(symbol)}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const pick = results[0]?.symbol ?? query.trim().toUpperCase();
        if (pick) open(pick);
      }}
      className="relative w-40 sm:w-56 md:w-64"
    >
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => window.setTimeout(() => setResults([]), 150)}
        placeholder="Search stocks…"
        aria-label="Search stocks"
        className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-8 text-sm outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
      />
      {loading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted" />}
      {results.length > 0 && (
        <div className="absolute right-0 z-40 mt-1 w-[300px] overflow-hidden rounded-xl border border-line bg-[#121821] shadow-2xl">
          {results.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => open(item.symbol)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
            >
              <span className="min-w-0">
                <span className="font-semibold">{item.symbol}</span>
                <span className="ml-2 truncate text-xs text-muted">{item.name}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted">{item.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
