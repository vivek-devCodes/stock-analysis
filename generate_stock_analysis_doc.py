import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
import datetime
import os

def create_document():
    doc = docx.Document()

    # Configure Margins
    for section in doc.sections:
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)

    # Palette
    C_PRIMARY = RGBColor(16, 37, 66)      # Deep Navy #102542
    C_ACCENT = RGBColor(91, 140, 255)     # Electric Blue #5B8CFF
    C_SECONDARY = RGBColor(61, 214, 140)  # Forest Green #3DD68C
    C_DARK = RGBColor(30, 41, 59)         # Slate Dark #1E293B
    C_MUTED = RGBColor(100, 116, 139)     # Slate Muted #64748B
    C_WARN = RGBColor(245, 197, 66)       # Amber #F5C542
    C_DANGER = RGBColor(255, 92, 122)     # Rose Red #FF5C7A

    # Set normal style
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Segoe UI'
    normal_style.font.size = Pt(10.5)
    normal_style.font.color.rgb = C_DARK

    def set_cell_background(cell, hex_color):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        tcPr.append(shd)

    def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
        tcPr.append(tcMar)

    def add_callout(text, title="KEY TAKEAWAY", hex_bg="F0F4FF", hex_border="5B8CFF"):
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.cell(0, 0)
        cell.width = Inches(6.8)
        set_cell_background(cell, hex_bg)
        set_cell_margins(cell, top=140, bottom=140, left=200, right=200)

        # Border left
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(f'<w:tcBorders {nsdecls("w")}><w:left w:val="single" w:sz="24" w:space="0" w:color="{hex_border}"/><w:top w:val="none"/><w:right w:val="none"/><w:bottom w:val="none"/></w:tcBorders>')
        tcPr.append(borders)

        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(2)
        r_title = p.add_run(f"📌 {title}\n")
        r_title.bold = True
        r_title.font.size = Pt(10)
        r_title.font.color.rgb = C_PRIMARY

        r_text = p.add_run(text)
        r_text.font.size = Pt(9.5)
        r_text.font.color.rgb = C_DARK

        doc.add_paragraph().paragraph_format.space_after = Pt(4)

    def add_header(title, level=1):
        h = doc.add_paragraph()
        h.paragraph_format.keep_with_next = True
        run = h.add_run(title)
        run.bold = True
        if level == 1:
            h.paragraph_format.space_before = Pt(18)
            h.paragraph_format.space_after = Pt(6)
            run.font.size = Pt(17)
            run.font.color.rgb = C_PRIMARY
            # Add bottom accent line
        elif level == 2:
            h.paragraph_format.space_before = Pt(14)
            h.paragraph_format.space_after = Pt(4)
            run.font.size = Pt(13.5)
            run.font.color.rgb = C_ACCENT
        elif level == 3:
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.space_after = Pt(2)
            run.font.size = Pt(11.5)
            run.font.color.rgb = C_DARK

    def add_bullet(bold_prefix, text):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(2)
        r_bold = p.add_run(bold_prefix + ": ")
        r_bold.bold = True
        r_bold.font.color.rgb = C_PRIMARY
        r_text = p.add_run(text)
        r_text.font.color.rgb = C_DARK

    # ==========================================
    # COVER / HEADER
    # ==========================================
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(24)
    title_p.paragraph_format.space_after = Pt(4)
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    trun = title_p.add_run("APEX DESK — STOCK ANALYSIS TERMINAL\n& LLM RECOMMENDATION ENGINE")
    trun.bold = True
    trun.font.size = Pt(22)
    trun.font.color.rgb = C_PRIMARY

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_before = Pt(0)
    sub_p.paragraph_format.space_after = Pt(18)
    sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    srun = sub_p.add_run("Comprehensive Technical Specification, System Architecture & Operational Blueprint")
    srun.font.size = Pt(12)
    srun.font.color.rgb = C_MUTED

    meta_tbl = doc.add_table(rows=1, cols=4)
    meta_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    labels = [("Project", "Apex Stock Analysis"), ("Version", "2.0 (LLM Enabled)"), ("Date", datetime.date.today().strftime("%B %d, %Y")), ("Status", "Production Ready")]
    for i, (k, v) in enumerate(labels):
        c = meta_tbl.cell(0, i)
        c.width = Inches(1.7)
        set_cell_background(c, "F8FAFC")
        set_cell_margins(c, top=80, bottom=80, left=100, right=100)
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        rk = p.add_run(f"{k}\n")
        rk.font.size = Pt(8.5)
        rk.font.color.rgb = C_MUTED
        rv = p.add_run(v)
        rv.bold = True
        rv.font.size = Pt(9.5)
        rv.font.color.rgb = C_PRIMARY

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # ==========================================
    # 1. EXECUTIVE SUMMARY & MISSION
    # ==========================================
    add_header("1. Executive Summary & Mission Overview", level=1)
    
    p = doc.add_paragraph()
    p.add_run(
        "Apex Desk is a high-performance, institutional-grade stock analysis and intelligence platform tailored "
        "for Indian and global equity markets (NSE, BSE, US Equities, and Cryptocurrencies). The platform bridges "
        "the gap between quantitative technical indicators, probabilistic mathematical forecasts, and modern AI "
        "reasoning by combining local computational algorithms with Google Gemini 2.5 Flash Large Language Models."
    )

    p2 = doc.add_paragraph()
    p2.add_run(
        "The system has been engineered to solve a core problem faced by retail and proprietary traders: "
        "information overload and late morning execution. By scanning pre-market data and fundamental/technical metrics "
        "across all Indian sectors, the system synthesizes findings into an automated recommendation email dispatched "
        "precisely at 08:45 AM IST (30 minutes prior to Indian market opening at 09:15 AM). This provides traders "
        "with well-calibrated intraday, short-term, and long-term setups complete with entry, target, and stop-loss levels."
    )

    add_callout(
        "Apex Desk operates 100% autonomously without recurring subscription fees or mandatory broker API tokens. "
        "It scrapes real-time price feeds and quotes from NSE/BSE and Yahoo Finance, computes 15+ mathematical indicators, "
        "and coordinates with Gemini LLM to generate actionable intelligence before market open.",
        title="CORE ARCHITECTURAL ADVANTAGE"
    )

    # ==========================================
    # 2. COMPLETE TECHNICAL STACK
    # ==========================================
    add_header("2. Technology Stack & Runtime Infrastructure", level=1)

    tech_data = [
        ("Layer", "Technology", "Version", "Role & Justification"),
        ("Frontend Framework", "Next.js (App Router)", "16.4.0", "Server-rendered React 19 app with Turbopack, sub-second route compilation"),
        ("UI Library", "React & Lucide React", "19.3.0 / 1.55.0", "Reactive terminal UI, custom SVG charting components, zero-overhead icons"),
        ("Styling System", "Tailwind CSS v4", "4.0.0", "Modern CSS variables, ultra-fast inline theme tokens, native dark mode"),
        ("Financial Charting", "Lightweight Charts", "5.2.1", "TradingView's native canvas rendering engine; 60fps performance with synced crosshairs"),
        ("Intelligence Engine", "Google Gemini 2.5 Flash", "@google/genai 2.30", "Deep financial reasoning with 1M context window and strict JSON schema output"),
        ("Email Dispatcher", "Nodemailer", "10.1.7", "SMTP transport with inline CSS responsive template engine for Gmail / enterprise relays"),
        ("Automation Scheduler", "node-cron & tsx", "4.6.0 / 4.19", "Lightweight cron daemon running at 8:45 AM IST with pre-market rate limit handling"),
        ("Data Aggregation", "NSE Unofficial API + Yahoo", "Direct Feeds", "Zero-cost real-time and historical OHLCV feeds for NSE (.NS) and BSE (.BO)")
    ]

    tbl = doc.add_table(rows=len(tech_data), cols=4)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r_idx, row in enumerate(tech_data):
        for c_idx, val in enumerate(row):
            cell = tbl.cell(r_idx, c_idx)
            set_cell_margins(cell, top=70, bottom=70, left=100, right=100)
            p = cell.paragraphs[0]
            if r_idx == 0:
                set_cell_background(cell, "102542")
                run = p.add_run(val)
                run.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)
                run.font.size = Pt(9)
            else:
                bg = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
                set_cell_background(cell, bg)
                run = p.add_run(val)
                run.font.size = Pt(9)
                if c_idx == 1:
                    run.bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # ==========================================
    # 3. COMPLETE FILE-BY-FILE BREAKDOWN
    # ==========================================
    add_header("3. Complete File-by-File Functional Breakdown", level=1)
    
    p = doc.add_paragraph()
    p.add_run("Every single file in the codebase has a specialized responsibility. Below is an exhaustive breakdown of each component:")

    add_header("3.1. Type Definitions & Data Contracts (src/lib/types.ts)", level=2)
    add_bullet("Candle", "Defines the standard OHLCV bar (time, open, high, low, close, volume).")
    add_bullet("Quote", "Extensive fundamental and session snapshot (price, change, changePercent, previousClose, open, dayHigh, dayLow, volume, averageVolume, marketCap, pe, eps, 52W High/Low, dividendYield, beta, sector, industry, marketState).")
    add_bullet("Indicators", "Houses scalar indicator outputs and time-series arrays for SMA20, SMA50, SMA200, EMA12, EMA26, RSI(14), MACD, MACD Signal, MACD Hist, Bollinger Upper/Middle/Lower, ATR, ATR%, Stochastic %K/%D, Volume SMA, Volume Ratio, and Realized Volatility.")
    add_bullet("Insight & Signal", "Quantifies technical scores, confidence levels, working bullish factors, not-working bearish factors, key risks, dynamic pivot support/resistance, and signal badges.")
    add_bullet("Forecast & ForecastPoint", "Ensemble trajectory points (time, mean, low 10th percentile, high 90th percentile), expectedPrice, expectedChangePercent, and model confidence.")
    add_bullet("AlertRule & AlertEvent", "User-defined triggers for price_above, price_below, pct_change, volume_spike, and volatility_spike, with real-time browser notifications.")

    add_header("3.2. Technical & Mathematical Calculation Engine (src/lib/indicators.ts)", level=2)
    p = doc.add_paragraph()
    p.add_run(
        "Unlike basic platforms that rely on external third-party indicator libraries, Apex Desk implements "
        "all mathematical indicators natively from scratch with zero dependency overhead. This guarantees exact floating-point "
        "precision and sub-millisecond execution:"
    )
    add_bullet("Simple Moving Average (SMA)", "Sliding window O(N) accumulator over 20, 50, and 200 periods.")
    add_bullet("Exponential Moving Average (EMA)", "Weighted smoothing with multiplier k = 2 / (period + 1), initialized with the arithmetic mean of the seed window.")
    add_bullet("Relative Strength Index (RSI 14)", "Wilder's exponential smoothing of upward and downward price differentials; measures overbought (>70) and oversold (<30) conditions.")
    add_bullet("MACD (12, 26, 9)", "Fast EMA(12) minus Slow EMA(26); signal line is EMA(9) of the MACD line; histogram measures directional acceleration.")
    add_bullet("Bollinger Bands (20, 2σ)", "Middle band = SMA20; Upper and Lower bands are plotted at 2 sample standard deviations.")
    add_bullet("Average True Range (ATR 14)", "True Range = max(H - L, |H - C_prev|, |L - C_prev|); smoothed over 14 bars to measure absolute volatility in points and percentages.")
    add_bullet("Stochastic Oscillator (%K, %D)", "Fast stochastic %K = (Close - Lowest Low) / (Highest High - Lowest Low) * 100, smoothed via 3-period SMA; %D is a 3-period SMA of %K.")
    add_bullet("Annualized Realized Volatility", "Calculates log returns ln(P_t / P_t-1) over the trailing 21 sessions, computes variance, and annualizes via sqrt(252) * 100.")
    add_bullet("Dynamic Pivot Clustering", "Scans an 80-bar window for 5-bar local extrema (H > H±1, H > H±2). Clusters neighboring pivot points within a 1.2% distance threshold to formulate dynamic support and resistance levels.")

    add_header("3.3. Probabilistic Ensemble Forecasting Engine (src/lib/forecast.ts)", level=2)
    p = doc.add_paragraph()
    p.add_run(
        "Inspired by state-of-the-art tokenized K-line models (such as Kronos), this module implements an ensemble "
        "forecasting model that projects future price trajectories without requiring multi-gigabyte neural network weights:"
    )
    add_bullet("Log-Linear Regression", "Fits an ordinary least squares trendline on logarithmic close prices over a trailing 120-bar window, computing slope, intercept, and R² goodness of fit.")
    add_bullet("AR(1) Residual Shock Modeling", "Calculates first-order autoregressive correlation phi = sum(e_t * e_t-1) / sum(e_t-1²), dampening noise while preserving directional memory.")
    add_bullet("Momentum & Reversion Bias", "Injects dual mathematical priors: momentum bias derived from RSI divergence and MACD histogram slope, paired with mean-reversion drift toward SMA50.")
    add_bullet("Non-Parametric Uncertainty Cones", "Computes the 10th and 90th percentiles of historical return residuals, scaling uncertainty by sqrt(h) * (1 + 4 * ATR%) to generate realistic probabilistic prediction funnels.")

    add_header("3.4. Rule-Based Quantitative Insight Engine (src/lib/analysis.ts)", level=2)
    p = doc.add_paragraph()
    p.add_run(
        "Evaluates the multi-indicator state space using a deterministic scoring matrix (-100 to +100). "
        "Moving average crossovers grant ±14 points; 200DMA trend regime filters grant ±8 points; RSI extremes and momentum "
        "zones grant up to ±10 points; MACD histograms add ±8 points; volume surges add ±4 points; and news sentiment adds ±6 points. "
        "A composite score >= +18 issues a BUY recommendation, <= -18 issues a SELL recommendation, and intermediate values issue a HOLD. "
        "It also segregates specific observations into 'What is working', 'What is not', and 'Risks'."
    )

    add_header("3.5. Market Data Aggregation Layer (src/lib/yahoo.ts & src/lib/nse-scraper.ts)", level=2)
    add_bullet("Yahoo Finance Query Engine", "Dispatches resilient multi-mirror HTTP requests with Chrome User-Agent emulation. Auto-maps timeframe ranges (1d to 5y) to appropriate candle granularities (5m to 1wk). Enriches raw ticker quotes with P/E, EPS, Market Cap, Beta, 52W range, Sector, and Industry.")
    add_bullet("NSE India Unofficial Scraper", "Implements automated cookie handshakes with www.nseindia.com. Caches session cookies for 5 minutes and queries official indices (/api/equity-stockIndices), top gainers/losers (/api/live-analysis-variations), and pre-market open books (/api/market-data-pre-open).")
    add_bullet("Stock Universe Definition", "Categorizes 60+ premier NSE equities across 10 vital sectors: Banking, IT, Pharma, Auto, FMCG, Energy, Metal, Realty, Infrastructure, and Finance.")

    add_header("3.6. Gemini LLM Deep Intelligence Engine (src/lib/llm-analyzer.ts)", level=2)
    p = doc.add_paragraph()
    p.add_run(
        "This module forms the cognitive core of the system. While traditional screeners only filter static numbers, "
        "Gemini 2.5 Flash ingests the complete contextual picture: technical indicator values, forecast trajectories, "
        "balance sheet fundamentals, news headlines, and sector rotation metrics. "
        "Using Google GenAI's strict responseJsonSchema mode, Gemini outputs guaranteed valid JSON containing:"
    )
    add_bullet("Market Sentiment", "Overall stance (BULLISH, BEARISH, NEUTRAL) with macro justification.")
    add_bullet("Intraday Recommendations", "Top 3-5 high-liquidity large caps with strict entry, target, and stop-loss levels.")
    add_bullet("Short-Term Swing Picks", "Top 3-5 setups for 1-2 week holding windows with catalyst reasoning.")
    add_bullet("Long-Term Value Picks", "Top 3-5 fundamentally sound companies suitable for 3-6 month positional investments.")
    add_bullet("Stocks to Avoid", "High-risk, overextended, or fundamentally compromised stocks with explicit warning reasons.")
    add_bullet("Sector Rotation Matrix", "Outlook, percent change, and sector leaders across all 10 major industry verticals.")

    add_header("3.7. Automated Scheduler & Email Dispatcher (src/scripts/daily-analysis.ts & src/lib/email-service.ts)", level=2)
    p = doc.add_paragraph()
    p.add_run(
        "Runs an automated cron daemon at 08:45 AM IST (03:15 AM UTC) every Monday through Friday. "
        "It analyzes stocks in throttled batches to prevent API rate limiting, runs the Gemini LLM synthesis, "
        "builds a dark-themed HTML email template, and dispatches the briefing via Gmail SMTP to configured traders. "
        "It can be executed as a background daemon, a standalone CLI command, or triggered on-demand via the web terminal."
    )

    add_header("3.8. Interactive Terminal Frontend (src/components/Dashboard.tsx & PriceChart.tsx)", level=2)
    add_bullet("Live Market Ticker", "Sticky header displaying Nifty 50, Sensex, Bank Nifty, S&P 500, Nasdaq, and Bitcoin prices with 60-second polling.")
    add_bullet("Symbol Search with Autocomplete", "Debounced search bar resolving global and Indian tickers instantly.")
    add_bullet("Multi-Series TradingView Chart", "Synchronized 3-tier canvas: Price/Candlestick + Volume, RSI(14) with Overbought/Oversold thresholds, and MACD Histogram + Signal lines.")
    add_bullet("Overlay Selector", "One-click toggling between SMA 20/50, EMA 12, Bollinger Bands, and Probabilistic Forecast cones.")
    add_bullet("Watchlist & Alert Terminal", "Stores custom favorites and monitors 5 alert conditions with 45-second background polling.")
    add_bullet("Daily AI Report Modal", "Allows traders to test email SMTP credentials and trigger on-demand market analysis directly from the web browser.")

    # ==========================================
    # 4. COMPREHENSIVE PLUS-POINT & FEATURE MATRIX
    # ==========================================
    add_header("4. Key Plus-Points & Competitive Advantages", level=1)

    points = [
        ("Feature / Advantage", "Apex Desk Implementation", "Traditional Competitors / Screener Apps"),
        ("Data Cost & Licensing", "100% Free; Yahoo + NSE real-time feeds without mandatory broker credentials", "Requires costly Zerodha/Upstox API tokens (Rs 2,000 - 4,000/mo)"),
        ("Pre-Market Dispatch Timing", "08:45 AM IST daily; delivers complete plan 30 mins before 9:15 AM opening bell", "Most apps deliver alerts after market open (9:30 AM+) when move has already occurred"),
        ("Three-Horizon Clarity", "Explicitly segregates Intraday (strict SL), Short-Term (1-2 weeks), and Long-Term (3-6 months)", "Mixes intraday scalp calls with long-term investments, confusing the trader"),
        ("LLM Model Choice", "Google Gemini 2.5 Flash; 1M token context, sub-3s latency, native JSON schema mode", "Generic GPT-4 wrappers with high API latency, token limits, and JSON hallucination"),
        ("Mathematical Forecasting", "Native log-linear regression + AR(1) shock decay + percentile uncertainty cones", "No forecasting; basic backward-looking moving averages only"),
        ("Multi-Tier Charting", "TradingView Lightweight Charts v5 with 3 synchronized sub-charts at 60 FPS", "Static image charts or slow chart libraries that lag on mobile / laptops"),
        ("Support / Resistance Logic", "Dynamic algorithmic clustering of 5-bar local pivot extrema", "Static arbitrary round numbers or manual user drawings"),
        ("Email Report Design", "Institutional dark-themed HTML email with confidence meters and risk badges", "Ugly plain-text emails or spammy notifications without structured tables"),
        ("SEBI & Risk Safeguards", "Embedded stop-losses, risk level tags (Low/Med/High), and statutory disclaimer", "Blind 'tips' without stop-loss or capital protection guidelines")
    ]

    tbl2 = doc.add_table(rows=len(points), cols=3)
    tbl2.alignment = WD_TABLE_ALIGNMENT.CENTER
    for r_idx, row in enumerate(points):
        for c_idx, val in enumerate(row):
            cell = tbl2.cell(r_idx, c_idx)
            set_cell_margins(cell, top=70, bottom=70, left=100, right=100)
            p = cell.paragraphs[0]
            if r_idx == 0:
                set_cell_background(cell, "102542")
                run = p.add_run(val)
                run.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)
                run.font.size = Pt(9)
            else:
                bg = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
                set_cell_background(cell, bg)
                run = p.add_run(val)
                run.font.size = Pt(9)
                if c_idx == 0:
                    run.bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # ==========================================
    # 5. STEP-BY-STEP OPERATIONAL GUIDE
    # ==========================================
    add_header("5. Setup, Configuration & Operational Guide", level=1)

    add_header("5.1. Environment Variables Configuration (.env)", level=2)
    p = doc.add_paragraph()
    p.add_run("Create a `.env` file in the root project directory with the following variables:")
    
    code_tbl = doc.add_table(rows=1, cols=1)
    cell = code_tbl.cell(0, 0)
    set_cell_background(cell, "0F172A")
    set_cell_margins(cell, top=100, bottom=100, left=150, right=150)
    cp = cell.paragraphs[0]
    crun = cp.add_run(
        "# Google Gemini API Key (Get free from https://aistudio.google.com)\n"
        "GEMINI_API_KEY=AIzaSyD...\n\n"
        "# Daily Email Dispatch Configuration (8:45 AM IST)\n"
        "SMTP_HOST=smtp.gmail.com\n"
        "SMTP_PORT=587\n"
        "SMTP_USER=your_email@gmail.com\n"
        "SMTP_PASS=your_16_char_gmail_app_password\n"
        "REPORT_RECIPIENTS=trader1@gmail.com,trader2@domain.com\n"
    )
    crun.font.name = 'Consolas'
    crun.font.size = Pt(8.5)
    crun.font.color.rgb = RGBColor(226, 232, 240)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    add_header("5.2. How to Generate a Free Gmail App Password", level=2)
    add_bullet("Step 1", "Log in to your Google Account and navigate to Security Settings (https://myaccount.google.com/security).")
    add_bullet("Step 2", "Ensure 2-Step Verification is turned ON.")
    add_bullet("Step 3", "Search for 'App passwords' in the search bar or visit https://myaccount.google.com/apppasswords.")
    add_bullet("Step 4", "Enter 'Stock Analysis' as the app name and click Generate.")
    add_bullet("Step 5", "Copy the generated 16-character password and paste it into `SMTP_PASS` in your `.env` file.")

    add_header("5.3. Execution Modes & CLI Commands", level=2)
    add_bullet("Development Web Server", "Run `npm run dev` to launch the interactive terminal at http://localhost:3000.")
    add_bullet("Test Email Connection", "Run `npm run test-email` to verify SMTP credentials before triggering full reports.")
    add_bullet("On-Demand Daily Report", "Run `npm run daily-report` to execute the full analysis pipeline and send an email immediately.")
    add_bullet("Automated Cron Daemon", "Run `npm run daily-report:cron` to leave the automation daemon running in the background. It will automatically trigger at 8:45 AM IST every Monday through Friday.")
    add_bullet("Web UI Trigger", "Open the terminal in your browser, click 'Daily AI Report (8:45 AM)', test credentials or click 'Run & Send Report Now'.")

    # ==========================================
    # 6. ARCHITECTURE WORKFLOW DIAGRAM
    # ==========================================
    add_header("6. Execution Flowchart & Data Pipeline", level=1)
    p = doc.add_paragraph()
    p.add_run(
        "1. [8:45 AM Trigger] node-cron fires at 03:15 UTC (08:45 IST).\n"
        "2. [Market Snapshot] Aggregates Nifty 50, Sensex, Bank Nifty, and top gainers/losers.\n"
        "3. [Sector Scan] Iterates through 10 Indian sectors (Banking, IT, Auto, Pharma, FMCG, Energy, Metal, etc.).\n"
        "4. [Technical Computations] Local computation of RSI, MACD, Bollinger Bands, ATR, Volatility, and Forecast Cones.\n"
        "5. [Gemini Cognitive Synthesis] Gemini 2.5 Flash reviews technicals + balance sheet fundamentals + news headlines.\n"
        "6. [JSON Schema Validation] Validates structured Intraday, Swing, Long-term, and Avoid lists.\n"
        "7. [Email Template Generation] Renders institutional dark-themed HTML with color badges and target prices.\n"
        "8. [SMTP Delivery] Nodemailer transmits the briefing to all recipient mailboxes before market open."
    )

    doc.save(r"c:\Users\dell\OneDrive\Documents\vivek project\stock-analysis\Stock_Analysis_System_Documentation.docx")
    print("Word document generated successfully!")

if __name__ == "__main__":
    create_document()
