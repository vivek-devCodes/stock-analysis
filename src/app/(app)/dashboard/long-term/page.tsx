import type { Metadata } from "next";
import { HorizonDashboard } from "@/components/HorizonDashboard";

export const metadata: Metadata = { title: "Long Term — Apex Desk" };

export default function Page() {
  return <HorizonDashboard mode="long-term" />;
}
