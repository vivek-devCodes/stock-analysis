"use client";

import { BadgeCheck, BookOpen, Hash, Inbox, Info, ListFilter, Search, Sigma, X } from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { clsx } from "@/lib/format";
import { GLOSSARY, GLOSSARY_GROUPS, groupOf, type GlossarySection, type GlossaryTerm } from "@/lib/glossary";
import { PageHeader } from "./shell/PageHeader";

type View = "section" | "az";

const TOTAL_TERMS = GLOSSARY.reduce((n, s) => n + s.terms.length, 0);

function matches(t: GlossaryTerm, q: string) {
  if (!q) return true;
  return [t.term, t.full, t.meaning, t.purpose, t.formula].some((v) => v?.toLowerCase().includes(q));
}

/** Wraps case-insensitive occurrences of the query in <mark>. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let hit = lower.indexOf(q);
  while (hit !== -1) {
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark key={hit} className="rounded-sm bg-[#fbbf24]/25 px-0.5 text-foreground">
        {text.slice(hit, hit + q.length)}
      </mark>,
    );
    i = hit + q.length;
    hit = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

function TermRow({ t, q, sectionLabel }: { t: GlossaryTerm; q: string; sectionLabel?: string }) {
  return (
    <div className="min-w-0 border-b border-line/60 py-3 last:border-b-0">
      <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="break-words font-semibold">
          <Hl text={t.term} q={q} />
        </span>
        {t.full && (
          <span className="break-words text-xs text-muted">
            <Hl text={t.full} q={q} />
          </span>
        )}
        {t.implemented && (
          <span title={t.implemented} className="inline-flex shrink-0 items-center gap-1 rounded bg-up/15 px-1.5 text-[10px] font-semibold text-up">
            <BadgeCheck className="h-3 w-3" aria-hidden />
            In Apex Desk
          </span>
        )}
        {sectionLabel && <span className="ml-auto shrink-0 rounded bg-white/5 px-1.5 text-[10px] text-muted">{sectionLabel}</span>}
      </dt>
      <dd className="mt-1 space-y-1 text-sm">
        {t.meaning !== t.full && (
          <p className="break-words text-foreground/85">
            <Hl text={t.meaning} q={q} />
          </p>
        )}
        {t.purpose && (
          <p className="break-words text-xs text-muted">
            <span className="font-medium text-foreground/60">Purpose: </span>
            <Hl text={t.purpose} q={q} />
          </p>
        )}
        {t.implemented && (
          <p className="break-words text-xs text-up/90">
            <span className="font-medium">In Apex Desk: </span>
            {t.implemented}
          </p>
        )}
        {t.formula && (
          <p className="mt-1.5 flex items-start gap-2 break-words rounded-md border-l-2 border-[#fbbf24] bg-[#fbbf24]/[0.07] px-2.5 py-1.5 font-mono text-xs text-[#fde68a]">
            <Sigma className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="Formula" />
            <span className="min-w-0">
              <Hl text={t.formula} q={q} />
            </span>
          </p>
        )}
      </dd>
    </div>
  );
}

function SectionBlock({ s, terms, q }: { s: GlossarySection; terms: GlossaryTerm[]; q: string }) {
  return (
    <section id={`glossary-${s.id}`} className="panel scroll-mt-20 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Hash className="h-4 w-4 shrink-0 text-[#fbbf24]" />
        <span className="font-mono text-muted">{s.number}</span>
        <span className="min-w-0 break-words">{s.title}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted">{terms.length}</span>
      </h2>
      {s.intro && !q && <p className="mt-2 text-xs leading-relaxed text-muted">{s.intro}</p>}
      <dl className="mt-2">
        {terms.map((t) => (
          <TermRow key={`${s.id}-${t.term}`} t={t} q={q} />
        ))}
      </dl>
      {s.notes && s.notes.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {s.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 break-words">{n}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export function GlossaryModule({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [group, setGroup] = useState("all");
  const [view, setView] = useState<View>("section");
  const [formulasOnly, setFormulasOnly] = useState(false);
  const q = useDeferredValue(query.trim().toLowerCase());

  // Sections with their matching terms (search + formula filter, before the chapter filter).
  const searched = useMemo(
    () =>
      GLOSSARY.map((s) => ({ s, terms: s.terms.filter((t) => matches(t, q) && (!formulasOnly || !!t.formula)) })).filter(
        (x) => x.terms.length > 0,
      ),
    [q, formulasOnly],
  );

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of searched) counts.set(groupOf(x.s), (counts.get(groupOf(x.s)) ?? 0) + x.terms.length);
    return counts;
  }, [searched]);

  const visible = useMemo(() => searched.filter((x) => group === "all" || groupOf(x.s) === group), [searched, group]);
  const shownCount = visible.reduce((n, x) => n + x.terms.length, 0);

  const azGroups = useMemo(() => {
    if (view !== "az") return [];
    const rows = visible.flatMap((x) => x.terms.map((t) => ({ t, section: x.s })));
    rows.sort((a, b) => a.t.term.localeCompare(b.t.term, "en", { sensitivity: "base" }));
    const byLetter = new Map<string, typeof rows>();
    for (const r of rows) {
      const ch = r.t.term[0]?.toUpperCase() ?? "#";
      const letter = /[A-Z]/.test(ch) ? ch : "#";
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), r]);
    }
    return [...byLetter.entries()];
  }, [visible, view]);

  const reset = () => {
    setQuery("");
    setGroup("all");
    setFormulasOnly(false);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        icon={BookOpen}
        tone="text-[#fbbf24]"
        title="Glossary"
        subtitle={`${TOTAL_TERMS} stock-market terms across ${GLOSSARY_GROUPS.length} chapters — full forms, meanings and formulas`}
      />

      <div className="panel space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-56">
            <span className="sr-only">Search the glossary</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search terms, full forms, meanings or formulas — e.g. ROE, VWAP, theta"
              className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
            />
          </label>
          <div role="group" aria-label="View" className="flex overflow-hidden rounded-xl border border-line text-xs">
            {(
              [
                ["section", "By section"],
                ["az", "A–Z"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={clsx("px-3 py-2", view === v ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-muted hover:text-foreground">
            <input type="checkbox" checked={formulasOnly} onChange={(e) => setFormulasOnly(e.target.checked)} />
            <Sigma className="h-3.5 w-3.5" />
            Formulas only
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by chapter">
          <ListFilter className="h-3.5 w-3.5 text-muted" />
          <button
            type="button"
            onClick={() => setGroup("all")}
            aria-pressed={group === "all"}
            className={clsx(
              "rounded-lg border px-2 py-1 text-[11px]",
              group === "all" ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground",
            )}
          >
            All <span className="opacity-70">{[...groupCounts.values()].reduce((a, b) => a + b, 0)}</span>
          </button>
          {GLOSSARY_GROUPS.map((g) => {
            const n = groupCounts.get(g.number) ?? 0;
            return (
              <button
                key={g.number}
                type="button"
                onClick={() => setGroup(g.number)}
                aria-pressed={group === g.number}
                disabled={n === 0}
                className={clsx(
                  "rounded-lg border px-2 py-1 text-[11px] disabled:opacity-35",
                  group === g.number ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground",
                )}
              >
                <span className="font-mono">{g.number}.</span> {g.title} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted" aria-live="polite">
          Showing {shownCount} of {TOTAL_TERMS} terms
          {(query || group !== "all" || formulasOnly) && (
            <button type="button" onClick={reset} className="ml-2 inline-flex items-center gap-1 text-accent hover:underline">
              <X className="h-3 w-3" /> Clear filters
            </button>
          )}
        </p>
      </div>

      {shownCount === 0 ? (
        <div className="panel flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
          <Inbox className="h-8 w-8" />
          No terms match “{query}”{formulasOnly ? " with a formula" : ""}.
          <button type="button" onClick={reset} className="text-accent hover:underline">
            Clear search and filters
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label="Jump to section" className="hidden lg:block">
            <div className="panel sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Jump to</p>
              <ul className="space-y-0.5 text-xs">
                {visible.map(({ s, terms }) => (
                  <li key={s.id}>
                    <a
                      href={`#glossary-${s.id}`}
                      onClick={() => setView("section")}
                      className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-muted hover:bg-white/5 hover:text-foreground"
                    >
                      <span className="w-8 shrink-0 font-mono">{s.number}</span>
                      <span className="min-w-0 flex-1">{s.title}</span>
                      <span className="shrink-0 opacity-60">{terms.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="min-w-0 space-y-4">
            {view === "section"
              ? visible.map(({ s, terms }) => <SectionBlock key={s.id} s={s} terms={terms} q={q} />)
              : azGroups.map(([letter, rows]) => (
                  <section key={letter} className="panel p-4" aria-label={`Terms starting with ${letter}`}>
                    <h2 className="font-mono text-lg font-semibold text-[#fbbf24]">{letter}</h2>
                    <dl>
                      {rows.map(({ t, section }) => (
                        <TermRow key={`${section.id}-${t.term}`} t={t} q={q} sectionLabel={`§${section.number}`} />
                      ))}
                    </dl>
                  </section>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}
