import "server-only";
import type { PaperTrade } from "./paper/types";

/**
 * Instant phone alerts through a Telegram bot (free). Set two environment variables:
 *   TELEGRAM_BOT_TOKEN — from @BotFather (/newbot)
 *   TELEGRAM_CHAT_ID   — your chat id (send the bot a message, then open
 *                        https://api.telegram.org/bot<token>/getUpdates and copy message.chat.id)
 * Without them every call is a no-op. Messages never include secrets.
 */

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `Telegram HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const px = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const inr = (x: number) => `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
const sym = (s: string) => s.replace(/\.(NS|BO)$/, "");

export const notify = {
  entry: (t: PaperTrade) =>
    sendTelegram(
      `📥 <b>${t.side === "long" ? "BUY" : "SELL"} ${esc(sym(t.symbol))}</b> (paper, ${t.trigger === "plan" ? "from last night's plan" : "live agent"})\n` +
        `Entry ${px(t.entry)} · Stop ${px(t.stop)} · Target ${px(t.target)} · Qty ${t.qty}\n${esc(t.reasons[0] ?? "")}`,
    ),
  exit: (t: PaperTrade) => {
    const label = t.status === "target" ? "🎯 Target hit" : t.status === "stop" ? "🛑 Stop hit" : t.status === "breakeven" ? "⚖️ Stopped at entry" : "⏱ Squared off";
    return sendTelegram(`${label}: <b>${esc(sym(t.symbol))}</b> ${t.side} ${px(t.entry)} → ${px(t.exitPrice ?? t.entry)} · ${inr(t.netPnl ?? 0)} net (paper)`);
  },
  text: (text: string) => sendTelegram(text),
};
