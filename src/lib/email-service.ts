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

  if (report.watchlist?.length) {
    lines.push(`=== YOUR WATCHLIST ===`);
    report.watchlist.forEach((w) => {
      lines.push(`${w.recommendation} ${w.symbol} (${w.name}) — ${w.currency} ${w.price.toFixed(2)} (${w.changePercent >= 0 ? "+" : ""}${w.changePercent.toFixed(2)}%)`);
      lines.push(`  10-day range (80%): ${w.rangeLow.toFixed(2)} – ${w.rangeHigh.toFixed(2)} | Support ${w.support?.toFixed(2) ?? "—"} | Resistance ${w.resistance?.toFixed(2) ?? "—"}`);
      w.news.slice(0, 2).forEach((n) => lines.push(`  • ${n.title} (${n.publisher})`));
      lines.push(``);
    });
  }

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

/* ------------------------------------------------------------------ */
/*  Trade-signal alerts (multi-agent engine)                           */
/* ------------------------------------------------------------------ */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Plain, information-dense alert in the format the operating spec requires. */
export async function sendSignalEmail(params: {
  subject: string;
  lines: Array<[string, string]>;
  notes: string[];
}): Promise<{ success: boolean; error?: string }> {
  const to = (process.env.REPORT_RECIPIENTS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!to.length) return { success: false, error: "REPORT_RECIPIENTS not configured" };
  try {
    const transporter = createTransporter();
    const rows = params.lines
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#8b95a5;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0;color:#e8edf4">${escapeHtml(v)}</td></tr>`)
      .join("");
    const notes = params.notes.map((n) => `<li style="margin:4px 0">${escapeHtml(n)}</li>`).join("");
    await transporter.sendMail({
      from: `"Apex Desk — AI Analyst" <${process.env.SMTP_USER}>`,
      to: to.join(", "),
      subject: params.subject,
      text: [...params.lines.map(([k, v]) => `${k}: ${v}`), "", ...params.notes].join("\n"),
      html: `<div style="background:#0f1419;padding:20px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e8edf4">
        <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(params.subject)}</h2>
        <table style="font-size:14px;border-collapse:collapse">${rows}</table>
        <ul style="margin-top:16px;padding-left:18px;font-size:12px;color:#8b95a5">${notes}</ul>
      </div>`,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Email send failed" };
  }
}

/** Send a pre-rendered HTML email (used by the agent scan digest). */
export async function sendHtmlEmail(subject: string, html: string, text: string): Promise<{ success: boolean; error?: string }> {
  const to = (process.env.REPORT_RECIPIENTS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!to.length) return { success: false, error: "REPORT_RECIPIENTS not configured" };
  try {
    await createTransporter().sendMail({ from: `"Apex Desk — AI Analyst" <${process.env.SMTP_USER}>`, to: to.join(", "), subject, html, text });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Email send failed" };
  }
}
