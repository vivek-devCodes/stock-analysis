import type { Metadata } from "next";
import { HorizonDashboard } from "@/components/HorizonDashboard";

export const metadata: Metadata = { title: "Options (Call / Put) — Apex Desk" };

export default function Page() {
  return <HorizonDashboard mode="options" />;
}
