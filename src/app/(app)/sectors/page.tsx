import type { Metadata } from "next";
import { Suspense } from "react";
import { SectorsModule } from "@/components/sectors/SectorsModule";

export const metadata: Metadata = { title: "Sectors — Apex Desk" };

const SECTOR_RE = /^[A-Za-z&-]{2,24}$/;

/** /sectors shows all sectors; /sectors?sector=IT shows that sector's companies (shareable URL). */
async function SectorsWithParams({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).sector;
  const sector = typeof raw === "string" && SECTOR_RE.test(raw) ? raw : null;
  return <SectorsModule key={sector ?? "all"} initialSector={sector} />;
}

export default function SectorsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading sectors…</div>}>
      <SectorsWithParams searchParams={props.searchParams} />
    </Suspense>
  );
}
