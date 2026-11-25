import type { Metadata } from "next";
import { InsiderBuying } from "@/components/insider/InsiderBuying";

export const metadata: Metadata = { title: "Insider Buying — Apex Desk" };

export default function InsiderPage() {
  return <InsiderBuying />;
}
