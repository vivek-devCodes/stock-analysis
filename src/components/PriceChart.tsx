"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { AnalyzeResponse } from "@/lib/types";

type Props = {
  data: AnalyzeResponse;
  overlay: "sma" | "ema" | "bb" | "forecast";
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

export function PriceChart({ data, overlay }: Props) {
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const charts = useRef<IChartApi[]>([]);

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
    candles.setData(
      data.candles.map((c) => ({
        time: toTime(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

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

    const addLine = (color: string, values: Array<{ time: number; value: number }>) => {
      const series = priceChart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      series.setData(values.map((p) => ({ time: toTime(p.time), value: p.value })));
      return series;
    };

    if (overlay === "sma") {
      addLine("#5b8cff", data.indicators.series.sma20);
      addLine("#f5c542", data.indicators.series.sma50);
    }
    if (overlay === "ema") {
      addLine("#c084fc", data.indicators.series.ema12);
    }
    if (overlay === "bb") {
      addLine("#64748b", data.indicators.series.bb.map((b) => ({ time: b.time, value: b.upper })));
      addLine("#94a3b8", data.indicators.series.bb.map((b) => ({ time: b.time, value: b.middle })));
      addLine("#64748b", data.indicators.series.bb.map((b) => ({ time: b.time, value: b.lower })));
    }
    if (overlay === "forecast" && data.forecast.points.length) {
      const last = data.candles.at(-1);
      if (last) {
        const mean = priceChart.addSeries(LineSeries, {
          color: "#5b8cff",
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
        });
        const high = priceChart.addSeries(AreaSeries, {
          lineColor: "rgba(91,140,255,0.0)",
          topColor: "rgba(91,140,255,0.18)",
          bottomColor: "rgba(91,140,255,0.02)",
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const path = [
          { time: toTime(last.time), value: last.close },
          ...data.forecast.points.map((p) => ({ time: toTime(p.time), value: p.mean })),
        ];
        mean.setData(path);
        high.setData([
          { time: toTime(last.time), value: last.close },
          ...data.forecast.points.map((p) => ({ time: toTime(p.time), value: p.high })),
        ]);
        const low = priceChart.addSeries(LineSeries, {
          color: "rgba(91,140,255,0.45)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        low.setData([
          { time: toTime(last.time), value: last.close },
          ...data.forecast.points.map((p) => ({ time: toTime(p.time), value: p.low })),
        ]);
      }
    }

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

    priceChart.timeScale().fitContent();

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
      observer.disconnect();
      charts.current.forEach((c) => c.remove());
      charts.current = [];
    };
  }, [data, overlay]);

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
