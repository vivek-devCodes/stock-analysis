// ---------------------------------------------------------------------------
// email-template.ts – Beautiful HTML email builder for daily stock reports
// ---------------------------------------------------------------------------

export type StockPick = {
  symbol: string;
  name: string;
  sector: string;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  recommendation: "BUY" | "SELL" | "HOLD";
  confidence: number; // 0-100
  reasoning: string;
  technicalSignals: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type SectorAnalysis = {
  sector: string;
  outlook: "BULLISH" | "BEARISH" | "NEUTRAL";
  changePercent: number;
  topStock: string;
  reasoning: string;
};

/** Rule-based analysis of one stock from the user's own watchlist. */
export type WatchlistEntry = {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  changePercent: number;
  recommendation: "BUY" | "SELL" | "HOLD";
  score: number;
  confidence: number;
  rsi: number | null;
  forecastChangePercent: number;
  forecastPrice: number;
  support: number | null;
  resistance: number | null;
  signals: string[];
  risks: string[];
  news: Array<{ title: string; link: string; publisher: string; sentiment: "positive" | "negative" | "neutral" }>;
};

export type DailyReport = {
  date: string;
  watchlist?: WatchlistEntry[];
  marketOverview: {
    nifty: { price: number; change: number; changePercent: number };
    sensex: { price: number; change: number; changePercent: number };
    bankNifty: { price: number; change: number; changePercent: number };
    marketSentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    sentimentReason: string;
  };
  intradayPicks: StockPick[];
  shortTermPicks: StockPick[];
  longTermPicks: StockPick[];
  stocksToAvoid: Array<{ symbol: string; name: string; reason: string }>;
  sectorAnalysis: SectorAnalysis[];
  keyNews: Array<{
    headline: string;
    impact: string;
    sentiment: "positive" | "negative" | "neutral";
  }>;
  disclaimer: string;
};

// ── colour palette ──────────────────────────────────────────────────────────
const C = {
  bg: "#0f1419",
  bgCard: "#1a1f26",
  bgRow: "#151b22",
  bgRowAlt: "#1a2029",
  border: "#2a3140",
  text: "#e8edf4",
  textMuted: "#8b95a5",
  green: "#3dd68c",
  red: "#ff5c7a",
  yellow: "#f5c542",
  blue: "#5b8cff",
  accent: "#5b8cff",
} as const;

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Escape third-party text (news titles, names) before putting it in HTML. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function changeColor(value: number): string {
  return value >= 0 ? C.green : C.red;
}

function changeArrow(value: number): string {
  return value >= 0 ? "▲" : "▼";
}

function recBadge(rec: StockPick["recommendation"]): string {
  const colors: Record<string, string> = {
    BUY: C.green,
    SELL: C.red,
    HOLD: C.yellow,
  };
  const color = colors[rec] ?? C.textMuted;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${color}20;color:${color};font-weight:700;font-size:12px;letter-spacing:0.5px;">${rec}</span>`;
}

function riskBadge(risk: StockPick["riskLevel"]): string {
  const colors: Record<string, string> = {
    LOW: C.green,
    MEDIUM: C.yellow,
    HIGH: C.red,
  };
  const color = colors[risk] ?? C.textMuted;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color}15;color:${color};font-size:11px;font-weight:600;">${risk}</span>`;
}

function sentimentBadge(
  s: "BULLISH" | "BEARISH" | "NEUTRAL" | "positive" | "negative" | "neutral"
): string {
  const map: Record<string, { label: string; color: string }> = {
    BULLISH: { label: "🟢 Bullish", color: C.green },
    BEARISH: { label: "🔴 Bearish", color: C.red },
    NEUTRAL: { label: "🟡 Neutral", color: C.yellow },
    positive: { label: "🟢 Positive", color: C.green },
    negative: { label: "🔴 Negative", color: C.red },
    neutral: { label: "🟡 Neutral", color: C.yellow },
  };
  const { label, color } = map[s] ?? { label: s, color: C.textMuted };
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;background:${color}18;color:${color};font-weight:700;font-size:12px;">${label}</span>`;
}

function outlookBadge(o: SectorAnalysis["outlook"]): string {
  return sentimentBadge(o);
}

function confidenceBar(pct: number): string {
  const color =
    pct >= 75 ? C.green : pct >= 50 ? C.yellow : C.red;
  return `
    <div style="display:flex;align-items:center;gap:6px;">
      <div style="flex:1;height:8px;background:${C.border};border-radius:4px;overflow:hidden;min-width:60px;">
        <div style="width:${Math.min(pct, 100)}%;height:100%;background:${color};border-radius:4px;"></div>
      </div>
      <span style="color:${color};font-size:12px;font-weight:700;white-space:nowrap;">${pct}%</span>
    </div>`;
}

function sectionTitle(emoji: string, title: string): string {
  return `
    <tr><td style="padding:32px 28px 12px 28px;">
      <h2 style="margin:0;font-size:20px;color:${C.text};font-weight:700;">${emoji} ${title}</h2>
      <div style="margin-top:8px;height:2px;background:linear-gradient(90deg,${C.accent},transparent);border-radius:1px;"></div>
    </td></tr>`;
}

// ── stock picks table builder ───────────────────────────────────────────────

function stockTable(picks: StockPick[]): string {
  if (picks.length === 0) {
    return `<tr><td style="padding:0 28px 12px;">
      <p style="color:${C.textMuted};font-size:14px;margin:0;">No picks for today.</p>
    </td></tr>`;
  }

  const headerStyle = `style="padding:10px 12px;text-align:left;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};"`;

  const rows = picks
    .map((p, i) => {
      const bg = i % 2 === 0 ? C.bgRow : C.bgRowAlt;
      const upsidePercent =
        p.recommendation === "SELL"
          ? ((p.currentPrice - p.targetPrice) / p.currentPrice) * 100
          : ((p.targetPrice - p.currentPrice) / p.currentPrice) * 100;
      const upsideColor = upsidePercent >= 0 ? C.green : C.red;

      return `
        <tr style="background:${bg};">
          <td style="padding:12px;border-bottom:1px solid ${C.border};">
            <div style="font-weight:700;color:${C.text};font-size:14px;">${p.symbol}</div>
            <div style="font-size:11px;color:${C.textMuted};margin-top:2px;">${p.name}</div>
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};text-align:center;">
            ${recBadge(p.recommendation)}
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};text-align:right;color:${C.text};font-size:14px;font-weight:600;">
            ₹${fmt(p.currentPrice)}
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};text-align:right;">
            <div style="color:${C.green};font-size:14px;font-weight:600;">₹${fmt(p.targetPrice)}</div>
            <div style="color:${upsideColor};font-size:11px;margin-top:2px;">${upsidePercent >= 0 ? "+" : ""}${upsidePercent.toFixed(1)}%</div>
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};text-align:right;color:${C.red};font-size:14px;font-weight:600;">
            ₹${fmt(p.stopLoss)}
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};min-width:100px;">
            ${confidenceBar(p.confidence)}
          </td>
          <td style="padding:12px;border-bottom:1px solid ${C.border};text-align:center;">
            ${riskBadge(p.riskLevel)}
          </td>
        </tr>
        <tr style="background:${bg};">
          <td colspan="7" style="padding:4px 12px 12px;border-bottom:1px solid ${C.border};">
            <div style="color:${C.textMuted};font-size:12px;line-height:1.5;">
              ${p.reasoning}
            </div>
            ${
              p.technicalSignals.length > 0
                ? `<div style="margin-top:6px;">${p.technicalSignals
                    .map(
                      (s) =>
                        `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:${C.accent}15;color:${C.accent};border-radius:3px;font-size:11px;">${s}</span>`
                    )
                    .join("")}</div>`
                : ""
            }
          </td>
        </tr>`;
    })
    .join("");

  return `
    <tr><td style="padding:0 28px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden;border-collapse:separate;">
        <thead>
          <tr style="background:${C.bgCard};">
            <th ${headerStyle}>Stock</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:center;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Signal</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:right;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Price</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:right;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Target</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:right;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Stop Loss</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:left;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Confidence</th>
            <th ${headerStyle} style="padding:10px 12px;text-align:center;font-size:11px;color:${C.textMuted};text-transform:uppercase;letter-spacing:0.8px;border-bottom:1px solid ${C.border};">Risk</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </td></tr>`;
}

// ── main builder ────────────────────────────────────────────────────────────

export function buildEmailHTML(report: DailyReport): string {
  const { marketOverview: mo } = report;

  // ── index card helper ──
  function indexCard(
    label: string,
    data: { price: number; change: number; changePercent: number }
  ): string {
    const color = changeColor(data.change);
    return `
      <td width="33%" style="padding:8px;">
        <div style="background:${C.bgRow};border:1px solid ${C.border};border-radius:8px;padding:16px;text-align:center;">
          <div style="color:${C.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${label}</div>
          <div style="color:${C.text};font-size:22px;font-weight:700;">${fmt(data.price)}</div>
          <div style="color:${color};font-size:14px;font-weight:600;margin-top:4px;">
            ${changeArrow(data.change)} ${fmt(Math.abs(data.change))} (${data.changePercent >= 0 ? "+" : ""}${data.changePercent.toFixed(2)}%)
          </div>
        </div>
      </td>`;
  }

  // ── stocks to avoid ──
  function stocksToAvoidSection(): string {
    if (report.stocksToAvoid.length === 0) return "";
    const items = report.stocksToAvoid
      .map(
        (s) => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid ${C.border};">
            <div style="display:inline-block;">
              <span style="font-weight:700;color:${C.red};font-size:14px;">${s.symbol}</span>
              <span style="color:${C.textMuted};font-size:13px;margin-left:6px;">${s.name}</span>
            </div>
            <div style="color:${C.textMuted};font-size:12px;margin-top:4px;">${s.reason}</div>
          </td>
        </tr>`
      )
      .join("");

    return `
      ${sectionTitle("🔴", "Stocks to Avoid")}
      <tr><td style="padding:0 28px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden;border-collapse:separate;background:${C.bgRow};">
          <tbody>${items}</tbody>
        </table>
      </td></tr>`;
  }

  // ── sector analysis ──
  function sectorSection(): string {
    if (report.sectorAnalysis.length === 0) return "";
    const cards = report.sectorAnalysis
      .map((s) => {
        const chgColor = changeColor(s.changePercent);
        return `
        <div style="background:${C.bgRow};border:1px solid ${C.border};border-radius:8px;padding:16px;margin-bottom:10px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;">
              <div style="font-weight:700;color:${C.text};font-size:15px;margin-bottom:4px;">${s.sector}</div>
              <div style="margin-bottom:6px;">${outlookBadge(s.outlook)}</div>
              <div style="color:${C.textMuted};font-size:12px;line-height:1.5;">${s.reasoning}</div>
            </td>
            <td style="vertical-align:top;text-align:right;width:130px;">
              <div style="color:${chgColor};font-size:18px;font-weight:700;">${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%</div>
              <div style="color:${C.textMuted};font-size:11px;margin-top:4px;">Top: <span style="color:${C.accent};font-weight:600;">${s.topStock}</span></div>
            </td>
          </tr></table>
        </div>`;
      })
      .join("");

    return `
      ${sectionTitle("📊", "Sector Analysis")}
      <tr><td style="padding:0 28px 20px;">
        ${cards}
      </td></tr>`;
  }

  // ── key news ──
  function newsSection(): string {
    if (report.keyNews.length === 0) return "";
    const items = report.keyNews
      .map(
        (n) => `
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid ${C.border};">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <div>
                <div style="color:${C.text};font-size:14px;font-weight:600;margin-bottom:4px;">${n.headline}</div>
                <div style="color:${C.textMuted};font-size:12px;margin-bottom:6px;">${n.impact}</div>
                ${sentimentBadge(n.sentiment)}
              </div>
            </div>
          </td>
        </tr>`
      )
      .join("");

    return `
      ${sectionTitle("📰", "Key News & Events")}
      <tr><td style="padding:0 28px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden;border-collapse:separate;background:${C.bgRow};">
          <tbody>${items}</tbody>
        </table>
      </td></tr>`;
  }

  // ── your watchlist ──
  function watchlistSection(): string {
    const list = report.watchlist ?? [];
    if (list.length === 0) return "";
    const cards = list
      .map((w) => {
        const recColor = w.recommendation === "BUY" ? C.green : w.recommendation === "SELL" ? C.red : C.yellow;
        const level = (v: number | null) => (v == null ? "—" : fmt(v));
        const news = w.news
          .slice(0, 2)
          .map(
            (n) =>
              `<div style="margin-top:4px;font-size:12px;"><span style="color:${n.sentiment === "positive" ? C.green : n.sentiment === "negative" ? C.red : C.textMuted};">●</span> <a href="${esc(safeUrl(n.link))}" style="color:${C.text};text-decoration:none;">${esc(n.title)}</a> <span style="color:${C.textMuted};">— ${esc(n.publisher)}</span></div>`,
          )
          .join("");
        return `
        <div style="background:${C.bgRow};border:1px solid ${C.border};border-left:3px solid ${recColor};border-radius:8px;padding:14px 16px;margin-bottom:10px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:top;">
              <span style="font-weight:700;color:${C.text};font-size:15px;">${esc(w.symbol)}</span>
              <span style="color:${C.textMuted};font-size:12px;margin-left:6px;">${esc(w.name)}</span>
              <div style="margin-top:6px;">${recBadge(w.recommendation)} <span style="color:${C.textMuted};font-size:11px;margin-left:6px;">score ${w.score} · confidence ${w.confidence}%${w.rsi != null ? ` · RSI ${w.rsi.toFixed(1)}` : ""}</span></div>
            </td>
            <td style="vertical-align:top;text-align:right;width:160px;">
              <div style="color:${C.text};font-size:16px;font-weight:700;">${esc(w.currency)} ${fmt(w.price)}</div>
              <div style="color:${changeColor(w.changePercent)};font-size:12px;">${changeArrow(w.changePercent)} ${w.changePercent.toFixed(2)}% today</div>
            </td>
          </tr></table>
          <div style="margin-top:8px;font-size:12px;color:${C.textMuted};">
            10-bar forecast: <span style="color:${changeColor(w.forecastChangePercent)};font-weight:600;">${w.forecastChangePercent >= 0 ? "+" : ""}${w.forecastChangePercent.toFixed(2)}% → ${fmt(w.forecastPrice)}</span>
            &nbsp;·&nbsp; Support <span style="color:${C.green};">${level(w.support)}</span>
            &nbsp;·&nbsp; Resistance <span style="color:${C.red};">${level(w.resistance)}</span>
          </div>
          ${w.signals.length ? `<div style="margin-top:6px;font-size:12px;color:${C.text};">✔ ${w.signals.slice(0, 3).map(esc).join(" · ")}</div>` : ""}
          ${w.risks.length ? `<div style="margin-top:4px;font-size:12px;color:${C.yellow};">⚠ ${w.risks.slice(0, 2).map(esc).join(" · ")}</div>` : ""}
          ${news}
        </div>`;
      })
      .join("");
    return `
      ${sectionTitle("⭐", "Your Watchlist")}
      <tr><td style="padding:0 28px 20px;">${cards}</td></tr>`;
  }

  // ── assemble ──────────────────────────────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <title>Apex Desk — Daily Stock Report</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.bg};">
    <tr><td align="center" style="padding:20px 12px;">

      <!-- Main container -->
      <table width="680" cellpadding="0" cellspacing="0" role="presentation" style="max-width:680px;width:100%;background:${C.bgCard};border-radius:12px;overflow:hidden;border:1px solid ${C.border};">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#141a22 0%,#1a2332 100%);padding:32px 28px;border-bottom:1px solid ${C.border};">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td>
                <div style="font-size:26px;font-weight:800;color:${C.text};letter-spacing:-0.5px;">📊 Apex Desk</div>
                <div style="font-size:14px;color:${C.accent};margin-top:4px;font-weight:600;">Daily Stock Report</div>
              </td>
              <td style="text-align:right;vertical-align:top;">
                <div style="color:${C.textMuted};font-size:13px;">${report.date}</div>
              </td>
            </tr></table>
          </td>
        </tr>

        <!-- Market Overview -->
        ${sectionTitle("🌐", "Market Overview")}
        <tr><td style="padding:0 20px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${indexCard("NIFTY 50", mo.nifty)}
              ${indexCard("SENSEX", mo.sensex)}
              ${indexCard("BANK NIFTY", mo.bankNifty)}
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 20px;">
          <div style="text-align:center;">
            ${sentimentBadge(mo.marketSentiment)}
            <div style="color:${C.textMuted};font-size:12px;margin-top:8px;">${mo.sentimentReason}</div>
          </div>
        </td></tr>

        <!-- Your Watchlist -->
        ${watchlistSection()}

        <!-- Intraday Picks -->
        ${sectionTitle("🎯", "Intraday Picks")}
        ${stockTable(report.intradayPicks)}

        <!-- Short-Term Picks -->
        ${sectionTitle("📈", "Short-Term Picks (1–2 Weeks)")}
        ${stockTable(report.shortTermPicks)}

        <!-- Long-Term Picks -->
        ${sectionTitle("🏦", "Long-Term Picks (3–6 Months)")}
        ${stockTable(report.longTermPicks)}

        <!-- Stocks to Avoid -->
        ${stocksToAvoidSection()}

        <!-- Sector Analysis -->
        ${sectorSection()}

        <!-- Key News -->
        ${newsSection()}

        <!-- Disclaimer -->
        <tr><td style="padding:20px 28px 28px;">
          <div style="background:${C.bgRow};border:1px solid ${C.border};border-radius:8px;padding:16px;">
            <div style="font-size:12px;font-weight:700;color:${C.yellow};margin-bottom:6px;">⚠️ Disclaimer</div>
            <div style="font-size:11px;color:${C.textMuted};line-height:1.6;">${report.disclaimer}</div>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 28px;border-top:1px solid ${C.border};text-align:center;">
            <div style="color:${C.textMuted};font-size:11px;">
              Powered by <span style="color:${C.accent};font-weight:700;">Apex Desk</span> · AI-driven stock analysis
            </div>
            <div style="color:${C.textMuted};font-size:10px;margin-top:4px;">
              Generated on ${report.date}
            </div>
          </td>
        </tr>

      </table>
      <!-- /Main container -->

    </td></tr>
  </table>
</body>
</html>`;
}
