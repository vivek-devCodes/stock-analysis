import type { Metadata } from "next";
import { StockScreener } from "@/components/StockScreener";

export const metadata: Metadata = { title: "Stock Screener — Apex Desk" };

export default function ScreenerPage() {
  return <StockScreener />;
}
