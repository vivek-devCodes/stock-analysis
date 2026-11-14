import "server-only";
import { sendHtmlEmail } from "../email-service";
import { buildDigest } from "./digest";
import { evaluateOpenRecommendations } from "./evaluate";
import { claimDigest, markDigest, runScan, type ScanRun, type ScanSession } from "./scan";

/**
 * One scheduled agent session: (1) record outcomes of earlier recommendations, (2) scan and
 * analyse, (3) email the digest for pre-/post-market sessions (once per session per day).
 * Intraday sessions only send the per-recommendation alerts for APPROVED calls, to avoid
 * an email every 30 minutes.
 */
export async function runSession(session: ScanSession, opts: { email: boolean }) {
  const evaluation = session === "intraday" ? null : await evaluateOpenRecommendations().catch((e) => ({ checked: 0, closed: 0, errors: [String(e)] }));
  const run: ScanRun = await runScan(session);
  let email = "not sent";
  if (opts.email && session !== "intraday" && run.horizons.length) {
    if (await claimDigest(run)) {
      const d = buildDigest(run);
      const res = await sendHtmlEmail(d.subject, d.html, d.text);
      email = res.success ? "sent" : `failed: ${res.error}`;
      await markDigest(run, email);
    } else email = "already sent for this session";
  }
  return { run, evaluation, email };
}
