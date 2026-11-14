// Types and small row builders for the glossary data files. The builders map each kind of
// table in the source glossary (different column layouts) onto one GlossaryTerm shape.

export type GlossaryTerm = {
  term: string;
  full?: string;
  meaning: string;
  purpose?: string;
  formula?: string;
  /** Where Apex Desk calculates or uses this term (set in src/lib/glossary-status.ts). */
  implemented?: string;
};

export type GlossarySection = {
  id: string;
  number: string;
  title: string;
  intro?: string;
  terms: GlossaryTerm[];
  notes?: string[];
};

const ACRONYM = /^[A-Z0-9&+\-/%.() ]+$/;
const looksLikeFormula = (s: string) => /[÷×=]|\s[−+-]\s/.test(s);

/** "Term | Full Form / Meaning | Purpose" — acronyms keep column 2 as their full form. */
export function fm(term: string, col2: string, purpose?: string, formula?: string): GlossaryTerm {
  const acronym = ACRONYM.test(term) && term.length <= 16 && term !== col2;
  const base: GlossaryTerm =
    col2 === term
      ? { term, meaning: purpose ?? col2 } // column 2 just repeats the term
      : acronym
        ? { term, full: col2, meaning: purpose ?? col2 }
        : { term, meaning: col2, purpose };
  return formula ? { ...base, formula } : base;
}

/** "Term | Meaning | Purpose". */
export function mp(term: string, meaning: string, purpose?: string, formula?: string): GlossaryTerm {
  return formula ? { term, meaning, purpose, formula } : { term, meaning, purpose };
}

/** "Term | Full Form | Formula / Purpose" — column 3 becomes a formula when it is one. */
export function ff(term: string, full: string, col3: string, meaning?: string): GlossaryTerm {
  const f = full === term ? undefined : full;
  return looksLikeFormula(col3) ? { term, full: f, meaning: meaning ?? full, formula: col3 } : { term, full: f, meaning: meaning ?? col3 };
}

/** "Term | Full Form | Purpose". */
export function fp(term: string, full: string, purpose: string): GlossaryTerm {
  return full === term ? { term, meaning: purpose } : { term, full, meaning: purpose };
}

/** "Term | Full Form | Meaning". */
export function fmn(term: string, full: string, meaning: string): GlossaryTerm {
  return full === term ? { term, meaning } : { term, full, meaning };
}

/** "Term | Meaning | Typical Interpretation" (candlesticks). */
export function ti(term: string, meaning: string, interpretation: string): GlossaryTerm {
  return { term, meaning, purpose: interpretation };
}

/** Two-column "Term | Meaning" tables, with an optional full form. */
export function m(term: string, meaning: string, full?: string): GlossaryTerm {
  return full ? { term, full, meaning } : { term, meaning };
}
