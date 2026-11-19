import type { Metadata } from "next";
import { Portfolio } from "@/components/portfolio/Portfolio";

export const metadata: Metadata = { title: "Momentum + Quality Portfolio — Apex Desk" };

export default function PortfolioPage() {
  return <Portfolio />;
}
