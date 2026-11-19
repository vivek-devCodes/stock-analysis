import nodemailer from "nodemailer";

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
/*  Errors and connectivity check                                      */
/* ------------------------------------------------------------------ */

/** Turn nodemailer/Gmail errors into a message that says what to fix. */
export function explainSmtpError(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; message?: string };
  const msg = e?.message ?? String(error);
  if (/credentials missing/i.test(msg)) return msg.split(String.fromCharCode(10))[0];
  if (e?.code === "EAUTH" || e?.responseCode === 535 || e?.responseCode === 534) {
    return "Gmail rejected the login. SMTP_PASS must be a 16-character Google App Password (Google Account > Security > 2-Step Verification > App passwords), not your normal Gmail password, and SMTP_USER must be the full Gmail address it was created for.";
  }
  if (e?.code === "ETIMEDOUT" || e?.code === "ECONNECTION" || e?.code === "ESOCKET" || e?.code === "ECONNREFUSED") {
    return `Could not reach the mail server (${e.code}). Check SMTP_HOST (smtp.gmail.com) and SMTP_PORT (587).`;
  }
  if (e?.code === "EDNS" || e?.code === "ENOTFOUND") return "SMTP_HOST could not be found. For Gmail use smtp.gmail.com.";
  return msg;
}

export async function testEmailConnection(): Promise<{ ok: boolean; error?: string; warning?: string }> {
  try {
    await createTransporter().verify();
    const hasRecipients = (process.env.REPORT_RECIPIENTS ?? "").split(",").some((v) => v.trim());
    return { ok: true, warning: hasRecipients ? undefined : "Login works, but REPORT_RECIPIENTS is empty, so reports have nowhere to go." };
  } catch (error) {
    return { ok: false, error: explainSmtpError(error) };
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

/** Send a pre-rendered HTML email (agent digests and the morning report). */
export async function sendHtmlEmail(subject: string, html: string, text: string): Promise<{ success: boolean; error?: string }> {
  const to = (process.env.REPORT_RECIPIENTS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!to.length) return { success: false, error: "REPORT_RECIPIENTS not configured" };
  try {
    await createTransporter().sendMail({ from: `"Apex Desk" <${process.env.SMTP_USER}>`, to: to.join(", "), subject, html, text });
    return { success: true };
  } catch (error) {
    return { success: false, error: explainSmtpError(error) };
  }
}
