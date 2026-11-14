"use client";

import { useEffect, useRef } from "react";
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
import { bollinger, crossSignals, donchian, ema, ichimoku, keltner, parabolicSar, sessionVwap, sma, supertrend, supertrendSignals, type ChartSignal, type Point } from "@/lib/chart-studies";
import type { SignalId, StudyId } from "@/lib/chart-config";

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

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || !macdRef.current) return;
    charts.current.forEach((c) => c.remove());
    charts.current = [];

    const priceChart = makeChart(priceRef.current, 360, 18);
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
    });
    priceChart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
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
    const c = data.candles;
    const intraday = data.interval !== "1d" && data.interval !== "1wk";

    if (has("sma")) {
      addLine("#5b8cff", sma(c, 20), { width: 2, lastValue: true });
      addLine("#f5c542", sma(c, 50), { width: 2, lastValue: true });
      addLine("#f472b6", sma(c, 200), { width: 2, lastValue: true });
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
    if (has("vwap") && intraday) addLine("#facc15", sessionVwap(c), { width: 2, lastValue: true });
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

    // BUY / SELL markers on the candles.
    const marks: ChartSignal[] = [];
    if (signals.includes("engine")) marks.push(...(data.engineSignals ?? []));
    if (signals.includes("supertrend")) marks.push(...supertrendSignals(c));
    if (signals.includes("golden-cross") && !intraday) marks.push(...crossSignals(c));
    const inRange = new Set(times);
    const colour = { engine: { buy: "#3dd68c", sell: "#ff5c7a" }, supertrend: { buy: "#22d3ee", sell: "#fb923c" }, "golden-cross": { buy: "#facc15", sell: "#e879f9" } } as const;
    const markers: SeriesMarker<Time>[] = marks
      .filter((m) => inRange.has(m.time))
      .sort((x, y) => x.time - y.time)
      .map((m) => ({
        time: toTime(m.time),
        position: m.side === "buy" ? "belowBar" : "aboveBar",
        shape: m.side === "buy" ? "arrowUp" : "arrowDown",
        color: colour[m.source][m.side],
        text: m.label,
        size: m.source === "engine" ? 1.2 : 1,
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
  }, [data, studies, signals]);

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
      <div ref={priceRef} className="w-full" />
      <p className="px-1 text-[10px] uppercase tracking-wider text-muted">RSI (14)</p>
      <div ref={rsiRef} className="w-full" />
      <p className="px-1 text-[10px] uppercase tracking-wider text-muted">MACD (12, 26, 9)</p>
      <div ref={macdRef} className="w-full" />
    </div>
  );
}
