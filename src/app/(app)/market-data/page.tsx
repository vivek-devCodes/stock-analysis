import type { Metadata } from "next";
import { MarketData } from "@/components/exchange/MarketData";

export const metadata: Metadata = { title: "NSE Market Data — Apex Desk" };

export default function MarketDataPage() {
  return <MarketData />;
}
