import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { glossaryHref } from "@/lib/glossary-links";
import { clsx } from "@/lib/format";

/** A metric label that links to its glossary definition (when one exists). */
export function TermLabel({ label, className }: { label: string; className?: string }) {
  const href = glossaryHref(label);
  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link
      href={href}
      title={`What is ${label}? Open the glossary`}
      className={clsx("underline decoration-dotted decoration-muted/60 underline-offset-2 hover:text-accent", className)}
    >
      {label}
    </Link>
  );
}

/** Small "?" link for places where the label itself is already a button (e.g. sortable headers). */
export function TermHelp({ label }: { label: string }) {
  const href = glossaryHref(label);
  if (!href) return null;
  return (
    <Link href={href} title={`What is ${label}? Open the glossary`} aria-label={`What is ${label}?`} className="text-muted hover:text-accent">
      <HelpCircle className="h-3 w-3" />
    </Link>
  );
}
