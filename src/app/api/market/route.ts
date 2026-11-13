import { fetchIndexQuotes } from "@/lib/yahoo";

const INDICES = [
  "^NSEI",
  "^BSESN",
  "^NSEBANK",
  "^GSPC",
  "^IXIC",
  "^DJI",
  "BTC-USD",
];

export async function GET() {
  try {
    const indices = await fetchIndexQuotes(INDICES);
    return Response.json({ indices, asOf: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market snapshot failed";
    return Response.json({ error: message, indices: [] }, { status: 502 });
  }
}
