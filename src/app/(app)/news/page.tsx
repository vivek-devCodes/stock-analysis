import type { Metadata } from "next";
import { NewsModule } from "@/components/NewsModule";

export const metadata: Metadata = { title: "Market News — Apex Desk" };

export default function NewsPage() {
  return <NewsModule />;
}
