"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { AnalyzeResponse, LiveQuote } from "@/lib/types";
import { bollinger, donchian, ema, ichimoku, keltner, parabolicSar, sessionVwap, sma, supertrend, supertrendSignals, type ChartSignal, type Point } from "@/lib/chart-studies";
import { SIGNAL_COLORS, type SignalId, type StudyId } from "@/lib/chart-config";
import { candlePatterns, dailyLevels, fairValueGaps, fibRetracement, marketStructure, srZones, trendlines, volumeProfile, vwapBands } from "@/lib/levels";
import { DrawingToolbar, loadDrawings, saveDrawings, type Drawing, type DrawTool } from "./DrawingToolbar";

const INTERVAL_SECONDS: Record<string, number> = { "5m": 300, "15m": 900, "1h": 3600, "1d": 86400, "1wk": 604800 };
type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

type Props = {
  data: AnalyzeResponse;
  /** Studies (indicators) drawn on the price pane. */
  studies: StudyId[];
  /** BUY/SELL marker sources drawn on the candles. */
  signals: SignalId[];
  /** Latest live tick for this symbol; moves the last candle (or opens a new one). */
  live?: LiveQuote | null;
};

const PATTERN_SHORT: Record<string, string> = {
  "Bullish engulfing": "Engulf",
  "Bearish engulfing": "Engulf",
  Hammer: "Hammer",
  "Shooting star": "Star",
  "Morning star": "M-Star",
  "Evening star": "E-Star",
};

function toTime(unix: number): UTCTimestamp {
  return unix as UTCTimestamp;
}

function makeChart(el: HTMLElement, height: number, rightOffset = 8) {
  return createChart(el, {
    height,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#8b97a8",
      fontFamily: "var(--font-geist-sans), sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "#1b2430" },
      horzLines: { color: "#1b2430" },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#243041" },
    timeScale: {
      borderColor: "#243041",
      timeVisible: true,
      secondsVisible: false,
      rightOffset,
    },
    localization: { priceFormatter: (p: number) => p.toFixed(p >= 100 ? 2 : 4) },
  });
}

export function PriceChart({ data, studies, signals, live }: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const charts = useRef<IChartApi[]>([]);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastBar = useRef<Bar | null>(null);
  // Remember the zoom per symbol+range so background refreshes don't reset it.
  const view = useRef<{ key: string; range: LogicalRange | null } | null>(null);
  // Drawing tools: the active tool (ref, so clicks see it without rebuilding), the first click of a
  // two-point drawing, and the saved drawings for this symbol (localStorage).
  const [tool, setTool] = useState<DrawTool>("none");
  const toolRef = useRef<DrawTool>("none");
  const pending = useRef<{ time: number; price: number } | null>(null);
  const [drawings, setDrawings] = useState<{ symbol: string; items: Drawing[] }>(() => ({ symbol: data.quote.symbol, items: loadDrawings(data.quote.symbol) }));
  // New symbol → load its drawings once (state adjusted during render, so `items` stays stable and
  // live ticks don't rebuild the chart).
  if (drawings.symbol !== data.quote.symbol) setDrawings({ symbol: data.quote.symbol, items: loadDrawings(data.quote.symbol) });
  const items = drawings.items;
  const [hint, setHint] = useState<string | null>(null);
  const chooseTool = (t: DrawTool) => {
    toolRef.current = t;
    pending.current = null;
    setTool(t);
    setHint(t === "none" ? null : t === "hline" ? "Click a price on the chart" : "Click the first point");
  };
  const updateDrawings = (next: Drawing[]) => {
    saveDrawings(data.quote.symbol, next);
    setDrawings({ symbol: data.quote.symbol, items: next });
  };

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || !macdRef.current) return;
    charts.current.forEach((c) => c.remove());
    charts.current = [];

    const priceChart = makeChart(priceRef.current, 540, 18);
    const rsiChart = makeChart(rsiRef.current, 110);
    const macdChart = makeChart(macdRef.current, 110);
    charts.current = [priceChart, rsiChart, macdChart];

    const candles = priceChart.addSeries(CandlestickSeries, {
      upColor: "#3dd68c",
      downColor: "#ff5c7a",
      borderUpColor: "#3dd68c",
      borderDownColor: "#ff5c7a",
      wickUpColor: "#3dd68c",
      wickDownColor: "#ff5c7a",
    });
    const bars: Bar[] = data.candles.map((c) => ({
      time: toTime(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candles.setData(bars);
    candleSeries.current = candles;
    lastBar.current = bars.at(-1) ?? null;

    const volume = priceChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    priceChart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });
    volume.setData(
      data.candles.map((c) => ({
        time: toTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? "rgba(61,214,140,0.35)" : "rgba(255,92,122,0.35)",
      })),
    );

    const times = data.candles.map((c) => c.time);
    /** Line with gaps: bars without a value become whitespace so the line breaks there. */
    const addLine = (color: string, values: Point[], opts: { width?: 1 | 2 | 3; dashed?: boolean; dots?: boolean; lastValue?: boolean; extendFuture?: boolean } = {}) => {
      const series = priceChart.addSeries(LineSeries, {
        color,
        lineWidth: opts.width ?? 1,
        lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
        lineVisible: !opts.dots,
        pointMarkersVisible: !!opts.dots,
        pointMarkersRadius: opts.dots ? 1.5 : undefined,
        priceLineVisible: false,
        lastValueVisible: opts.lastValue ?? false,
        crosshairMarkerVisible: !opts.dots,
      });
      const byTime = new Map(values.map((p) => [p.time, p.value]));
      const future = opts.extendFuture ? values.filter((p) => p.time > (times.at(-1) ?? 0)) : [];
      series.setData([
        ...times.map((t) => (byTime.has(t) ? { time: toTime(t), value: byTime.get(t)! } : { time: toTime(t) })),
        ...future.map((p) => ({ time: toTime(p.time), value: p.value })),
      ]);
      return series;
    };
    const has = (id: StudyId) => studies.includes(id);
    // Indicators are computed on the warm-up history too, then drawn only on the visible candles.
    const c = data.studyCandles?.length ? data.studyCandles : data.candles;
    const intraday = data.interval !== "1d" && data.interval !== "1wk";

    if (has("sma")) {
      addLine("#5b8cff", sma(c, 20), { width: 2 });
      addLine("#f5c542", sma(c, 50), { width: 2 });
      addLine("#f472b6", sma(c, 200), { width: 2 });
    }
    if (has("ema-ribbon")) {
      addLine("#22d3ee", ema(c, 9));
      addLine("#a78bfa", ema(c, 20));
      addLine("#fb923c", ema(c, 50), { width: 2 });
      addLine("#e879f9", ema(c, 200), { width: 2 });
    }
    if (has("bollinger")) {
      const bb = bollinger(c);
      addLine("#64748b", bb.upper);
      addLine("#94a3b8", bb.middle, { dashed: true });
      addLine("#64748b", bb.lower);
    }
    if (has("keltner")) {
      const k = keltner(c);
      addLine("#2dd4bf", k.upper, { dashed: true });
      addLine("#2dd4bf", k.lower, { dashed: true });
    }
    if (has("donchian")) {
      const d = donchian(c);
      addLine("#fbbf24", d.upper);
      addLine("#fbbf24", d.lower);
    }
    if (has("supertrend")) {
      const st = supertrend(c);
      addLine("#3dd68c", st.up, { width: 2 });
      addLine("#ff5c7a", st.down, { width: 2 });
    }
    if (has("psar")) addLine("#e2e8f0", parabolicSar(c), { dots: true });
    if (has("ichimoku")) {
      const ic = ichimoku(c);
      addLine("#38bdf8", ic.tenkan);
      addLine("#f87171", ic.kijun);
      addLine("rgba(61,214,140,0.8)", ic.spanA, { extendFuture: true });
      addLine("rgba(255,92,122,0.8)", ic.spanB, { extendFuture: true });
      addLine("rgba(167,139,250,0.6)", ic.lagging, { dashed: true });
    }
    if (has("vwap") && intraday) addLine("#facc15", sessionVwap(c), { width: 2 });
    if (has("levels")) {
      data.insight.support.slice(0, 2).forEach((price, i) =>
        candles.createPriceLine({ price, color: "#3dd68c", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `S${i + 1}` }),
      );
      data.insight.resistance.slice(0, 2).forEach((price, i) =>
        candles.createPriceLine({ price, color: "#ff5c7a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `R${i + 1}` }),
      );
    }
    if (has("range") && data.forecast.points.length) {
      const last = c.at(-1)!;
      const band = (key: "high" | "low") => [{ time: last.time, value: last.close }, ...data.forecast.points.map((p) => ({ time: p.time, value: p[key] }))];
      addLine("rgba(91,140,255,0.7)", band("high"), { dashed: true, extendFuture: true });
      addLine("rgba(91,140,255,0.7)", band("low"), { dashed: true, extendFuture: true });
    }

    /* ---- Pro tools (src/lib/levels.ts): the same levels the agents use ---- */
    const priceLine = (price: number, color: string, title: string, style: LineStyle = LineStyle.Dashed, width: 1 | 2 = 1) =>
      candles.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: title !== "", title });
    const visible = data.candles;
    if (has("zones")) {
      for (const z of srZones(c)) {
        const col = z.role === "support" ? "rgba(61,214,140,0.85)" : "rgba(255,92,122,0.85)";
        priceLine(z.high, col, `${z.role === "support" ? "S" : "R"} ${z.touches}×`, LineStyle.Solid, 2);
        priceLine(z.low, col, "", LineStyle.Dotted);
      }
    }
    if (has("trendlines")) {
      for (const t of trendlines(c)) {
        const start = c.findIndex((x) => x.time === t.from.time);
        if (start < 0) continue;
        const pts = c.slice(start).map((x, k) => ({ time: x.time, value: t.from.value + t.slopePerBar * k }));
        addLine(t.kind === "support" ? "#3dd68c" : "#ff5c7a", pts, { width: 2, dashed: t.broken });
      }
    }
    if (has("fib")) {
      const fib = fibRetracement(visible.length >= 30 ? visible : c);
      for (const l of fib?.levels ?? []) priceLine(l.price, l.ratio === 0.618 || l.ratio === 0.5 ? "#facc15" : "rgba(250,204,21,0.55)", `Fib ${l.label}`, l.ratio > 1 ? LineStyle.Dotted : LineStyle.Dashed);
    }
    if (has("pivots")) {
      const dl = dailyLevels(intraday ? visible : c);
      if (dl) {
        priceLine(dl.pivots.p, "#e2e8f0", "P", LineStyle.Solid);
        priceLine(dl.pivots.r1, "#fb7185", "R1");
        priceLine(dl.pivots.r2, "#fb7185", "R2", LineStyle.Dotted);
        priceLine(dl.pivots.s1, "#4ade80", "S1");
        priceLine(dl.pivots.s2, "#4ade80", "S2", LineStyle.Dotted);
        priceLine(dl.pdh, "#38bdf8", "PDH", LineStyle.Solid);
        priceLine(dl.pdl, "#38bdf8", "PDL", LineStyle.Solid);
        priceLine(dl.pdc, "#94a3b8", "PDC", LineStyle.Dotted);
      }
    }
    if (has("vwap-bands") && intraday) {
      const vb = vwapBands(c);
      addLine("#facc15", vb.vwap, { width: 2 });
      addLine("rgba(250,204,21,0.55)", vb.up1, { dashed: true });
      addLine("rgba(250,204,21,0.55)", vb.dn1, { dashed: true });
      addLine("rgba(250,204,21,0.3)", vb.up2, { dashed: true });
      addLine("rgba(250,204,21,0.3)", vb.dn2, { dashed: true });
    }
    if (has("vprofile")) {
      const vp = volumeProfile(visible);
      if (vp) {
        priceLine(vp.poc, "#c084fc", "POC", LineStyle.Solid, 2);
        priceLine(vp.vah, "rgba(192,132,252,0.6)", "VAH");
        priceLine(vp.val, "rgba(192,132,252,0.6)", "VAL");
      }
    }
    if (has("fvg")) {
      for (const g of fairValueGaps(c, 4)) {
        const col = g.kind === "bullish" ? "rgba(45,212,191,0.7)" : "rgba(251,146,60,0.7)";
        priceLine(g.top, col, `FVG ${g.kind === "bullish" ? "↑" : "↓"}`, LineStyle.Dotted);
        priceLine(g.bottom, col, "", LineStyle.Dotted);
      }
    }

    /* ---- the trader's own drawings ---- */
    for (const dr of items) {
      if (dr.kind === "hline") priceLine(dr.a.price, "#f8fafc", "Line", LineStyle.Solid);
      else if (dr.kind === "trend" && dr.b) {
        const [p1, p2] = dr.a.time <= dr.b.time ? [dr.a, dr.b] : [dr.b, dr.a];
        const span = p2.time - p1.time || 1;
        addLine("#f8fafc", times.filter((t) => t >= p1.time).map((t) => ({ time: t, value: p1.price + ((p2.price - p1.price) * (t - p1.time)) / span })), { width: 2 });
      } else if (dr.kind === "fib" && dr.b) {
        const hi = Math.max(dr.a.price, dr.b.price);
        const lo = Math.min(dr.a.price, dr.b.price);
        const upMove = dr.b.price >= dr.a.price;
        for (const r of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) priceLine(upMove ? hi - (hi - lo) * r : lo + (hi - lo) * r, "rgba(248,250,252,0.7)", `${(r * 100).toFixed(1)}%`, LineStyle.Dashed);
      }
    }
    priceChart.subscribeClick((param) => {
      const active = toolRef.current;
      if (active === "none" || !param.point || param.time == null) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null) return;
      const pt = { time: Number(param.time), price: Number(price) };
      if (active === "hline") {
        updateDrawings([...items, { id: `${Date.now()}`, kind: "hline", a: pt }]);
        chooseTool("none");
      } else if (!pending.current) {
        pending.current = pt;
        setHint("Click the second point");
      } else {
        updateDrawings([...items, { id: `${Date.now()}`, kind: active, a: pending.current, b: pt }]);
        chooseTool("none");
      }
    });

    // BUY / SELL markers on the candles.
    const marks: ChartSignal[] = [];
    const daily = data.dailySignals ?? [];
    if (signals.includes("engine")) marks.push(...daily.filter((m) => m.source === "engine"));
    if (signals.includes("supertrend")) marks.push(...supertrendSignals(c));
    if (signals.includes("golden-cross")) marks.push(...daily.filter((m) => m.source === "golden-cross"));
    if (signals.includes("structure")) marks.push(...marketStructure(c).events);
    if (signals.includes("pattern"))
      marks.push(
        ...candlePatterns(c)
          .filter((x) => x.side !== "neutral")
          .map((x) => ({ time: x.time, side: x.side as "buy" | "sell", source: "pattern" as const, label: x.name, detail: x.name })),
      );
    const inRange = new Set(times);
    const markers: SeriesMarker<Time>[] = marks
      .filter((m) => inRange.has(m.time))
      .sort((x, y) => x.time - y.time)
      .map((m) => ({
        time: toTime(m.time),
        position: m.side === "buy" ? "belowBar" : "aboveBar",
        shape: m.side === "buy" ? "arrowUp" : "arrowDown",
        color: SIGNAL_COLORS[m.source][m.side],
        // Every marker says what it is; the colour (see legend) says which rule fired it.
        text: m.source === "golden-cross" ? (m.side === "buy" ? "GC" : "DC") : m.source === "structure" ? m.label : m.source === "pattern" ? PATTERN_SHORT[m.label] ?? m.label : m.side === "buy" ? "BUY" : "SELL",
        size: m.source === "pattern" || m.source === "structure" ? 1 : 1.6,
      }));
    if (markers.length) createSeriesMarkers(candles, markers);

    const rsi = rsiChart.addSeries(LineSeries, {
      color: "#f5c542",
      lineWidth: 2,
      priceLineVisible: false,
    });
    rsi.setData(data.indicators.series.rsi.map((p) => ({ time: toTime(p.time), value: p.value })));
    rsi.createPriceLine({
      price: 70,
      color: "#ff5c7a",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "OB",
    });
    rsi.createPriceLine({
      price: 30,
      color: "#3dd68c",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "OS",
    });
    rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

    const hist = macdChart.addSeries(HistogramSeries, { priceFormat: { type: "price", precision: 2 } });
    hist.setData(
      data.indicators.series.macd.map((p) => ({
        time: toTime(p.time),
        value: p.hist,
        color: p.hist >= 0 ? "rgba(61,214,140,0.7)" : "rgba(255,92,122,0.7)",
      })),
    );
    const macd = macdChart.addSeries(LineSeries, { color: "#5b8cff", lineWidth: 2, priceLineVisible: false });
    const signal = macdChart.addSeries(LineSeries, { color: "#fb923c", lineWidth: 2, priceLineVisible: false });
    macd.setData(data.indicators.series.macd.map((p) => ({ time: toTime(p.time) as Time, value: p.macd })));
    signal.setData(data.indicators.series.macd.map((p) => ({ time: toTime(p.time) as Time, value: p.signal })));

    const sync = (source: IChartApi, others: IChartApi[]) => {
      source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        others.forEach((chart) => chart.timeScale().setVisibleLogicalRange(range));
      });
    };
    sync(priceChart, [rsiChart, macdChart]);
    sync(rsiChart, [priceChart, macdChart]);
    sync(macdChart, [priceChart, rsiChart]);

    const viewKey = `${data.quote.symbol}|${data.range}`;
    if (view.current?.key === viewKey && view.current.range) {
      priceChart.timeScale().setVisibleLogicalRange(view.current.range);
    } else {
      priceChart.timeScale().fitContent();
    }

    const resize = () => {
      charts.current.forEach((chart, i) => {
        const el = [priceRef.current, rsiRef.current, macdRef.current][i];
        if (el) chart.applyOptions({ width: el.clientWidth });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(priceRef.current);

    return () => {
      view.current = { key: viewKey, range: priceChart.timeScale().getVisibleLogicalRange() };
      candleSeries.current = null;
      observer.disconnect();
      charts.current.forEach((c) => c.remove());
      charts.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items/updateDrawings change with the drawings themselves
  }, [data, studies, signals, items]);

  // Live tick → update the forming candle, or start the next one when its interval has passed.
  useEffect(() => {
    const series = candleSeries.current;
    const last = lastBar.current;
    const step = INTERVAL_SECONDS[data.interval];
    if (!live || !series || !last || !step || live.symbol !== data.quote.symbol || live.time < last.time) return;
    let bar: Bar;
    if (live.time < last.time + step) {
      bar = { ...last, high: Math.max(last.high, live.price), low: Math.min(last.low, live.price), close: live.price };
    } else {
      const time = (last.time + step * Math.floor((live.time - last.time) / step)) as UTCTimestamp;
      bar = { time, open: live.price, high: live.price, low: live.price, close: live.price };
    }
    series.update(bar);
    lastBar.current = bar;
  }, [live, data.interval, data.quote.symbol]);

  return (
    <div className="space-y-2">
      <DrawingToolbar tool={tool} onTool={chooseTool} count={items.length} hint={hint} onClear={() => updateDrawings([])} onUndo={() => updateDrawings(items.slice(0, -1))} />
      <div ref={priceRef} className={tool === "none" ? "w-full" : "w-full cursor-crosshair"} />
      <p className="px-1 text-[10px] uppercase tracking-wider text-muted">RSI (14)</p>
      <div ref={rsiRef} className="w-full" />
      <p className="px-1 text-[10px] uppercase tracking-wider text-muted">MACD (12, 26, 9)</p>
      <div ref={macdRef} className="w-full" />
    </div>
  );
}
