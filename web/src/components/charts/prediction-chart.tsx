'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  type AutoscaleInfo,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

// Concrete colors — lightweight-charts paints to canvas and can't read CSS vars.
// Kept in sync with theme.css (--positive / --negative / --primary).
const POSITIVE = '#10b981';
const NEGATIVE = '#f43f5e';
const PRIMARY = '#4da2ff';
const AXIS_TEXT = '#7e97ba';
const AXIS_FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

type LinePoint = { time: UTCTimestamp; value: number };

/** Zip spots+times into strictly-ascending line data (lightweight-charts requires it). */
function buildData(spots: number[], times: number[]): LinePoint[] {
  const out: LinePoint[] = [];
  let prev = -Infinity;
  for (let i = 0; i < spots.length; i++) {
    const ms = times[i];
    if (ms == null || !Number.isFinite(spots[i])) continue;
    let t = Math.floor(ms / 1000);
    if (t <= prev) t = prev + 1; // de-collide same-second ticks
    out.push({ time: t as UTCTimestamp, value: spots[i] });
    prev = t;
  }
  return out;
}

/*
 * The hero prediction chart, two modes over one instrument:
 *  - single (Above/Below): a BaselineSeries pinned to the strike, so the area
 *    above fills "winning" green and below "losing" red — flipped for Below.
 *  - range: an AreaSeries with two draggable bound lines; the band between them
 *    tints green while price sits inside it.
 * Strike/bound handles are DOM overlays positioned from the price scale, and
 * dragging them snaps to the oracle tick grid and pushes state up. Pan/zoom are
 * off, so overlays only reposition on data / value / size changes.
 */
export function PredictionChart({
  spots,
  times,
  mode,
  strike,
  direction,
  lower,
  upper,
  tickSize,
  minStrike,
  label,
  onStrikeChange,
  onRangeChange,
  className,
}: {
  spots: number[];
  times: number[];
  mode: 'single' | 'range';
  strike: number;
  direction: 'UP' | 'DOWN';
  lower: number;
  upper: number;
  tickSize: number;
  minStrike: number;
  label?: string;
  onStrikeChange?: (price: number) => void;
  onRangeChange?: (lower: number, upper: number) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Stored as Baseline-typed for ergonomic applyOptions/setData; in range mode
  // it actually holds an Area series (structurally identical for our calls).
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const dataRef = useRef<LinePoint[]>([]);

  // Overlay elements.
  const strikeElRef = useRef<HTMLDivElement>(null);
  const upperElRef = useRef<HTMLDivElement>(null);
  const lowerElRef = useRef<HTMLDivElement>(null);

  // Live values for the imperative handlers so they never go stale.
  const modeRef = useRef(mode);
  const strikeRef = useRef(strike);
  const dirRef = useRef(direction);
  const lowerRef = useRef(lower);
  const upperRef = useRef(upper);
  const dragRef = useRef<'strike' | 'upper' | 'lower' | null>(null);
  const labelRef = useRef(label);
  const onStrikeRef = useRef(onStrikeChange);
  const onRangeRef = useRef(onRangeChange);
  labelRef.current = label;
  modeRef.current = mode;
  strikeRef.current = strike;
  dirRef.current = direction;
  lowerRef.current = lower;
  upperRef.current = upper;
  onStrikeRef.current = onStrikeChange;
  onRangeRef.current = onRangeChange;

  const reposition = useCallback(() => {
    const s = seriesRef.current;
    if (!s) return;
    const place = (node: HTMLDivElement | null, price: number) => {
      if (!node) return null;
      const y = s.priceToCoordinate(price);
      if (y == null) {
        node.style.display = 'none';
        return null;
      }
      node.style.display = '';
      node.style.top = `${y}px`;
      return y as number;
    };
    if (modeRef.current === 'single') {
      if (upperElRef.current) upperElRef.current.style.display = 'none';
      if (lowerElRef.current) lowerElRef.current.style.display = 'none';
      place(strikeElRef.current, strikeRef.current);
    } else {
      // The line is coloured green inside / red outside in applyData; here we
      // just place the two dashed bound lines.
      if (strikeElRef.current) strikeElRef.current.style.display = 'none';
      place(upperElRef.current, upperRef.current);
      place(lowerElRef.current, lowerRef.current);
    }
  }, []);

  const applySingleColors = useCallback(() => {
    const s = seriesRef.current;
    if (!s || modeRef.current !== 'single') return;
    const up = dirRef.current === 'UP';
    const topColor = up ? POSITIVE : NEGATIVE; // region above the strike
    const bottomColor = up ? NEGATIVE : POSITIVE; // region below the strike
    s.applyOptions({
      topLineColor: topColor,
      topFillColor1: hexA(topColor, 0.3),
      topFillColor2: hexA(topColor, 0.02),
      bottomLineColor: bottomColor,
      bottomFillColor1: hexA(bottomColor, 0.02),
      bottomFillColor2: hexA(bottomColor, 0.3),
    });
  }, []);

  const applyData = useCallback(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    if (modeRef.current === 'range') {
      // Per-point colour: green while the price is inside the band, red outside.
      const lo = lowerRef.current;
      const hi = upperRef.current;
      const colored = dataRef.current.map((p) => ({
        ...p,
        color: p.value >= lo && p.value <= hi ? POSITIVE : NEGATIVE,
      }));
      s.setData(colored as unknown as typeof dataRef.current);
    } else {
      s.setData(dataRef.current);
    }
    chart.timeScale().fitContent();
    reposition();
  }, [reposition]);
  // Stable handle so the drag/update effects can refit without taking applyData
  // as a dependency (keeps their dep arrays a constant size).
  const applyDataRef = useRef(applyData);
  applyDataRef.current = applyData;

  // Create the chart once.
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    // Inherit the app's font so axis labels match the ladder/price text.
    const appFont = getComputedStyle(el).fontFamily || AXIS_FONT;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
        textColor: AXIS_TEXT,
        fontSize: 12,
        fontFamily: appFont,
        attributionLogo: false,
      },
      // Clean "$75,251" labels on the price axis instead of raw floats.
      localization: {
        priceFormatter: (p: number) => `$${Math.round(p).toLocaleString('en-US')}`,
      },
      // Borderless, airy axes: no vertical gridlines, a whisper of horizontal
      // ones, and generous margins so the line floats in space.
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(148, 184, 255, 0.045)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.2, bottom: 0.2 },
        minimumWidth: 72,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 12,
        rightOffset: 6,
        fixLeftEdge: true,
        tickMarkFormatter: (time: Time) => {
          const d = new Date((time as number) * 1000);
          const h = d.getHours() % 12 || 12;
          return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(77, 162, 255, 0.35)', labelBackgroundColor: '#1d59e0' },
        horzLine: { color: 'rgba(77, 162, 255, 0.35)', labelBackgroundColor: '#1d59e0' },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    // Tracking tooltip — themed to Hunchbook glass.
    const onCrosshair = (param: MouseEventParams) => {
      const tip = tooltipRef.current;
      const mount = mountRef.current;
      const s = seriesRef.current;
      if (!tip || !mount || !s) return;
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      if (
        !param.point ||
        param.time == null ||
        param.point.x < 0 ||
        param.point.x > cw ||
        param.point.y < 0 ||
        param.point.y > ch
      ) {
        tip.style.display = 'none';
        return;
      }
      const data = param.seriesData.get(s) as { value?: number } | undefined;
      const price = data?.value;
      if (price == null) {
        tip.style.display = 'none';
        return;
      }
      const when = new Date(Number(param.time) * 1000).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      tip.style.display = 'block';
      tip.innerHTML =
        `<div style="color:#7e97ba;font-size:11px;text-transform:uppercase;letter-spacing:0.06em">${labelRef.current ?? ''}</div>` +
        `<div style="color:#eaf2ff;font-size:18px;font-weight:600;margin:2px 0;font-variant-numeric:tabular-nums">$${Math.round(price).toLocaleString('en-US')}</div>` +
        `<div style="color:#7e97ba;font-size:11px;font-variant-numeric:tabular-nums">${when}</div>`;
      const margin = 12;
      const w = 132;
      const h = 76;
      let left = param.point.x + margin;
      if (left > cw - w) left = param.point.x - margin - w;
      let top = param.point.y + margin;
      if (top > ch - h) top = param.point.y - h - margin;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, top)}px`;
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // (Re)create the series whenever the mode flips.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    if (mode === 'single') {
      seriesRef.current = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: strikeRef.current },
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      applySingleColors();
    } else {
      // Range = one line coloured per-point in applyData: green inside the band,
      // red outside it (the two-sided cousin of the Above/Below win/loss line).
      seriesRef.current = chart.addSeries(LineSeries, {
        color: PRIMARY,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        // Keep BOTH bounds on the y-axis so the dashed lines (and the green/red
        // split) stay visible — widen the price scale to include them.
        autoscaleInfoProvider: (orig: () => AutoscaleInfo | null) => {
          const res = orig();
          if (!res) return res;
          const lo = Math.min(res.priceRange.minValue, lowerRef.current);
          const hi = Math.max(res.priceRange.maxValue, upperRef.current);
          const pad = (hi - lo) * 0.12 || 1;
          return { priceRange: { minValue: lo - pad, maxValue: hi + pad }, margins: res.margins };
        },
      }) as unknown as ISeriesApi<'Baseline'>;
    }
    applyData();
  }, [mode, applySingleColors, applyData]);

  // Feed real ticks.
  useEffect(() => {
    dataRef.current = buildData(spots, times);
    applyData();
  }, [spots, times, applyData]);

  // Single-mode win/loss orientation.
  useEffect(() => {
    applySingleColors();
  }, [direction, applySingleColors]);

  // Move the baseline + overlays when the selected values change. The price
  // scale stays fixed to the data, so the reference line sits still.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    if (mode === 'single') {
      s.applyOptions({ baseValue: { type: 'price', price: strike } });
      reposition();
    } else {
      // Re-colour the line for the new band (green inside / red outside) and
      // re-place the dashed bounds. Scale fits the price, so it stays steady.
      applyDataRef.current();
    }
  }, [strike, lower, upper, mode, reposition]);

  // Keep overlays glued on resize.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(el);
    return () => ro.disconnect();
  }, [reposition]);

  // Drag any handle → snap to the oracle tick grid → push up to state.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const which = dragRef.current;
      if (!which) return;
      const s = seriesRef.current;
      const el = wrapRef.current;
      if (!s || !el) return;
      const rect = el.getBoundingClientRect();
      const price = s.coordinateToPrice(e.clientY - rect.top);
      if (price == null) return;
      const snapped = Math.max(Math.round((price as number) / tickSize) * tickSize, minStrike);
      if (which === 'strike') {
        onStrikeRef.current?.(snapped);
      } else if (which === 'upper') {
        onRangeRef.current?.(lowerRef.current, Math.max(snapped, lowerRef.current + tickSize));
      } else {
        onRangeRef.current?.(Math.min(snapped, upperRef.current - tickSize), upperRef.current);
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [tickSize, minStrike]);

  const grab = (which: 'strike' | 'upper' | 'lower') => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = which;
  };

  const handlePill = (label: string, color: string) => (
    <div
      className="pointer-events-auto absolute -top-3 right-16 flex h-6 cursor-grab touch-none items-center gap-1.5 rounded-md border bg-[#0d1523] px-2 font-mono text-xs font-semibold tabular-nums shadow-lg active:cursor-grabbing"
      style={{ borderColor: hexA(color, 0.5), color }}
    >
      <span className="h-2.5 w-0.5 rounded-full" style={{ background: hexA(color, 0.7) }} />
      {label}
    </div>
  );

  return (
    <div ref={wrapRef} className={cn('relative h-[420px] w-full', className)}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* Tracking tooltip (themed). */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-20 rounded-lg border border-primary/40 bg-[#0d1523]/95 px-2.5 py-2 shadow-xl backdrop-blur-md"
        style={{ display: 'none' }}
      />

      {/* Single-strike handle (Above/Below). */}
      <div
        ref={strikeElRef}
        className="pointer-events-none absolute inset-x-0 z-10 -translate-y-1/2"
        style={{ display: 'none' }}
      >
        <div className="relative border-t border-dashed border-primary/70">
          <div onPointerDown={grab('strike')}>{handlePill(formatUsd(strike, 0), PRIMARY)}</div>
        </div>
      </div>

      {/* Range bound handles (dashed lines); the line itself is coloured
          green inside / red outside in applyData. */}
      <div
        ref={upperElRef}
        className="pointer-events-none absolute inset-x-0 z-10 -translate-y-1/2"
        style={{ display: 'none' }}
      >
        <div className="relative border-t border-dashed border-primary/70">
          <div onPointerDown={grab('upper')}>{handlePill(formatUsd(upper, 0), PRIMARY)}</div>
        </div>
      </div>
      <div
        ref={lowerElRef}
        className="pointer-events-none absolute inset-x-0 z-10 -translate-y-1/2"
        style={{ display: 'none' }}
      >
        <div className="relative border-t border-dashed border-primary/70">
          <div onPointerDown={grab('lower')}>{handlePill(formatUsd(lower, 0), PRIMARY)}</div>
        </div>
      </div>
    </div>
  );
}
