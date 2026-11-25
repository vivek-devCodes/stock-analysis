import type { Metadata } from "next";
import { Scorecard } from "@/components/learn/Scorecard";

export const metadata: Metadata = { title: "Scorecard — Apex Desk" };

export default function ScorecardPage() {
  return <Scorecard />;
}
