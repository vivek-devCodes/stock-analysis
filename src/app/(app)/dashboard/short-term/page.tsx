import type { Metadata } from "next";
import { HorizonDashboard } from "@/components/HorizonDashboard";

export const metadata: Metadata = { title: "Short Term — Apex Desk" };

export default function Page() {
  return <HorizonDashboard mode="short-term" />;
}
