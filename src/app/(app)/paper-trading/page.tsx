import type { Metadata } from "next";
import { PaperTrading } from "@/components/paper/PaperTrading";

export const metadata: Metadata = { title: "Paper Trading — Apex Desk" };

export default function Page() {
  return <PaperTrading />;
}
