import type { Metadata } from "next";
import { Suspense } from "react";
import { GlossaryModule } from "@/components/GlossaryModule";

export const metadata: Metadata = { title: "Glossary — Apex Desk" };

/** ?q=RSI pre-fills the search, so metric labels elsewhere can link straight to a definition. */
async function GlossaryWithQuery({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = (await searchParams).q;
  return <GlossaryModule initialQuery={typeof q === "string" ? q.slice(0, 80) : ""} />;
}

export default function GlossaryPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<GlossaryModule />}>
      <GlossaryWithQuery searchParams={props.searchParams} />
    </Suspense>
  );
}
