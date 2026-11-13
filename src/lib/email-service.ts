import nodemailer from "nodemailer";
import type { DailyReport } from "./email-template";
import { buildEmailHTML } from "./email-template";

/* ------------------------------------------------------------------ */
/*  Transporter configuration                                          */
/* ------------------------------------------------------------------ */

function createTransporter() {
  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";

  if (!user || !pass) {
    throw new Error(
      "Email credentials missing. Set SMTP_USER and SMTP_PASS in your .env file.\n" +
        "For Gmail: use an App Password (https://myaccount.google.com/apppasswords).",
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/* ------------------------------------------------------------------ */
/*  Send daily report email                                            */
/* ------------------------------------------------------------------ */

export async function sendDailyReport(
  report: DailyReport,
  recipients?: string[],
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const to = recipients ?? (process.env.REPORT_RECIPIENTS ?? "").split(",").map((e) => e.trim()).filter(Boolean);

  if (!to.length) {
    return { success: false, error: "No recipients configured. Set REPORT_RECIPIENTS in .env." };
  }

  try {
    const transporter = createTransporter();

    const html = buildEmailHTML(report);

    const subject = `📊 Daily Stock Report — ${report.date} | Market: ${report.marketOverview.marketSentiment} | Nifty ${report.marketOverview.nifty.changePercent >= 0 ? "+" : ""}${report.marketOverview.nifty.changePercent.toFixed(2)}%`;

    const info = await transporter.sendMail({
      from: `"Apex Desk — Stock Analysis" <${process.env.SMTP_USER}>`,
      to: to.join(", "),
      subject,
      html,
      text: buildPlainText(report),
    });

    console.log(`[Email] Report sent to ${to.join(", ")} — MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed";
    console.error("[Email] Failed:", message);
    return { success: false, error: message };
  }
}

/* ------------------------------------------------------------------ */
/*  Plain-text fallback                                                */
/* ------------------------------------------------------------------ */

function buildPlainText(report: DailyReport): string {
  const lines: string[] = [
    `APEX DESK — DAILY STOCK REPORT`,
    `Date: ${report.date}`,
    ``,
    `=== MARKET OVERVIEW ===`,
    `Nifty 50: ₹${report.marketOverview.nifty.price.toFixed(2)} (${report.marketOverview.nifty.changePercent >= 0 ? "+" : ""}${report.marketOverview.nifty.changePercent.toFixed(2)}%)`,
    `Sensex: ₹${report.marketOverview.sensex.price.toFixed(2)} (${report.marketOverview.sensex.changePercent >= 0 ? "+" : ""}${report.marketOverview.sensex.changePercent.toFixed(2)}%)`,
    `Bank Nifty: ₹${report.marketOverview.bankNifty.price.toFixed(2)} (${report.marketOverview.bankNifty.changePercent >= 0 ? "+" : ""}${report.marketOverview.bankNifty.changePercent.toFixed(2)}%)`,
    `Sentiment: ${report.marketOverview.marketSentiment} — ${report.marketOverview.sentimentReason}`,
    ``,
  ];

  const addPicks = (title: string, picks: typeof report.intradayPicks) => {
    lines.push(`=== ${title} ===`);
    picks.forEach((p) => {
      lines.push(`${p.recommendation} ${p.symbol} (${p.name})`);
      lines.push(`  Price: ₹${p.currentPrice.toFixed(2)} → Target: ₹${p.targetPrice.toFixed(2)} | SL: ₹${p.stopLoss.toFixed(2)}`);
      lines.push(`  Confidence: ${p.confidence}% | Risk: ${p.riskLevel} | Sector: ${p.sector}`);
      lines.push(`  ${p.reasoning}`);
      lines.push(``);
    });
  };

  addPicks("INTRADAY PICKS", report.intradayPicks);
  addPicks("SHORT-TERM PICKS (1-2 Weeks)", report.shortTermPicks);
  addPicks("LONG-TERM PICKS (3-6 Months)", report.longTermPicks);

  lines.push(`=== STOCKS TO AVOID ===`);
  report.stocksToAvoid.forEach((s) => {
    lines.push(`🔴 ${s.symbol} (${s.name}) — ${s.reason}`);
  });
  lines.push(``);

  lines.push(`=== SECTOR ANALYSIS ===`);
  report.sectorAnalysis.forEach((s) => {
    lines.push(`${s.sector}: ${s.outlook} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%) — Top: ${s.topStock}`);
    lines.push(`  ${s.reasoning}`);
  });
  lines.push(``);

  lines.push(`=== KEY NEWS ===`);
  report.keyNews.forEach((n) => {
    lines.push(`[${n.sentiment.toUpperCase()}] ${n.headline}`);
    lines.push(`  Impact: ${n.impact}`);
  });
  lines.push(``);

  lines.push(`---`);
  lines.push(report.disclaimer);

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Test email connectivity                                            */
/* ------------------------------------------------------------------ */

export async function testEmailConnection(): Promise<boolean> {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log("[Email] SMTP connection verified successfully.");
    return true;
  } catch (error) {
    console.error("[Email] SMTP verification failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
