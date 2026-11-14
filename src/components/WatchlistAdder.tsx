"use client";

import { Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";

/** Type a company name or ticker, pick a match, and it is added to the watchlist. */
export function WatchlistAdder({ watchlist, onAdd }: { watchlist: string[]; onAdd: (symbol: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onQueryChange = (value: string) => {
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
        setResults(json.results ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const add = (symbol: string) => {
    onAdd(symbol.toUpperCase());
    onQueryChange("");
  };

  return (
    <div className="relative mb-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) add(results[0].symbol);
        }}
        className="flex items-center gap-1 rounded-lg border border-line bg-card px-2"
      >
        <Plus className="h-3.5 w-3.5 shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Add stock (e.g. Infosys)"
          aria-label="Add stock to watchlist"
          className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-muted"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />}
      </form>
      {results.length > 0 && (
        <div className="absolute z-30 mt-1 w-[280px] overflow-hidden rounded-xl border border-line bg-[#121821] shadow-2xl">
          {results.map((item) => {
            const added = watchlist.includes(item.symbol);
            return (
              <button
                key={item.symbol}
                type="button"
                disabled={added}
                onClick={() => add(item.symbol)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{item.symbol}</span>
                  <span className="ml-2 truncate text-muted">{item.name}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted">{added ? "Added" : item.exchange}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
