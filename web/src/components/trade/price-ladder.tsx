'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const ROW_H = 40; // px — keep in sync with h-10 on rows
const HALF_SPAN = 10_000; // ladder spans spot ± this
const EDGE_ZONE = 40; // px from the edge where dragging auto-scrolls
const EDGE_SCROLL_SPEED = 7;
const STEP_PRESETS = [100, 250, 500] as const;
export const DEFAULT_LADDER_STEP = 250;

/*
 * The permanent "Set a Price or Range" sidebar. One ladder, two modes:
 *  - single (Above/Below): the strike row is a blue handle; tap any row or drag
 *    the handle to move it.
 *  - range: a charcoal band framed in blue between two draggable bound rows.
 * Row granularity is chosen with the step presets in the header. Selections are
 * pushed up so the chart and bet panel stay in lockstep; the ladder scrolls,
 * dragging never scrolls the list.
 */
export function PriceLadder({
  mode,
  spot,
  minStrike,
  strike,
  onStrikeChange,
  lower,
  upper,
  onRangeChange,
  className,
}: {
  mode: 'single' | 'range';
  spot: number;
  minStrike: number;
  strike: number;
  onStrikeChange: (price: number) => void;
  lower: number;
  upper: number;
  onRangeChange: (lower: number, upper: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<number>(DEFAULT_LADDER_STEP);
  const [dragging, setDragging] = useState<'strike' | 'upper' | 'lower' | null>(null);
  const pointerY = useRef<number | null>(null);

  const prices = useMemo(() => {
    const rowsEachSide = Math.round(HALF_SPAN / step);
    const center = Math.round(spot / step) * step;
    const list: number[] = [];
    for (let i = rowsEachSide; i >= -rowsEachSide; i--) {
      const p = center + i * step;
      if (p >= Math.max(minStrike, step)) list.push(p);
    }
    return list;
  }, [spot, step, minStrike]);

  const topPrice = prices[0] ?? 0;
  const floor = prices[prices.length - 1] ?? 0;
  const strikeRow = Math.min(Math.max(Math.round(strike / step) * step, floor), topPrice);

  const priceAtY = (clientY: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top + el.scrollTop) / ROW_H);
    if (idx < 0 || idx >= prices.length) return null;
    return topPrice - idx * step;
  };

  const moveHandle = (which: 'strike' | 'upper' | 'lower', price: number) => {
    if (which === 'strike') {
      if (price >= floor && price <= topPrice) onStrikeChange(price);
    } else if (which === 'upper') {
      if (price >= lower + step && price <= topPrice) onRangeChange(lower, price);
    } else {
      if (price <= upper - step && price >= floor) onRangeChange(price, upper);
    }
  };

  const startDrag = (which: 'strike' | 'upper' | 'lower', e: React.PointerEvent) => {
    e.preventDefault();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    pointerY.current = e.clientY;
    setDragging(which);
  };

  // Keep dragging + scrolling while the pointer sits in an edge zone.
  const dragTick = useRef<() => void>(() => {});
  dragTick.current = () => {
    const el = containerRef.current;
    const y = pointerY.current;
    if (!el || !dragging || y === null) return;
    const rect = el.getBoundingClientRect();
    if (y < rect.top + EDGE_ZONE) el.scrollTop -= EDGE_SCROLL_SPEED;
    else if (y > rect.bottom - EDGE_ZONE) el.scrollTop += EDGE_SCROLL_SPEED;
    else return;
    const price = priceAtY(y);
    if (price !== null) moveHandle(dragging, price);
  };
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const loop = () => {
      dragTick.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  // Snap the band onto the new grid when the step preset changes, so the bound
  // rows stay highlightable instead of falling between rows.
  useEffect(() => {
    if (mode !== 'range') return;
    const lo = Math.round(lower / step) * step;
    const hi = Math.max(Math.round(upper / step) * step, lo + step);
    if (lo !== lower || hi !== upper) onRangeChange(lo, hi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Center the selection on mount and when the grid changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prices.length === 0) return;
    const mid = mode === 'range' ? (upper + lower) / 2 : strikeRow;
    const idx = (topPrice - mid) / step;
    el.scrollTop = idx * ROW_H - el.clientHeight / 2 + ROW_H / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topPrice, step, mode]);

  const upperIdx = (topPrice - upper) / step;
  const lowerIdx = (topPrice - lower) / step;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Set a {mode === 'range' ? 'Range' : 'Price'}
        </span>
        <div className="flex gap-1">
          {STEP_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={cn(
                'h-6 rounded-md border px-2 font-mono text-[11px] tabular-nums transition-colors',
                step === s
                  ? 'border-transparent bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white'
                  : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35]',
              )}
            >
              ${s}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[29rem] overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-[#0d0f14] bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] px-2 [background-size:28px_28px] [scrollbar-width:thin]"
        onPointerMove={(e) => {
          pointerY.current = e.clientY;
          if (!dragging) return;
          const price = priceAtY(e.clientY);
          if (price !== null) moveHandle(dragging, price);
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <div className="relative">
          {prices.map((p) => {
            const isStrike = mode === 'single' && p === strikeRow;
            const isUpper = mode === 'range' && p === upper;
            const isLower = mode === 'range' && p === lower;
            const isHandle = isStrike || isUpper || isLower;
            const inside = mode === 'range' && p < upper && p > lower;
            return (
              <button
                key={p}
                type="button"
                onPointerDown={(e) => {
                  if (isStrike) startDrag('strike', e);
                  else if (isUpper) startDrag('upper', e);
                  else if (isLower) startDrag('lower', e);
                }}
                onClick={() => {
                  if (isHandle) return;
                  if (mode === 'single') {
                    moveHandle('strike', p);
                  } else if (p > upper) moveHandle('upper', p);
                  else if (p < lower) moveHandle('lower', p);
                  else if (upper - p <= p - lower) moveHandle('upper', p);
                  else moveHandle('lower', p);
                }}
                className={cn(
                  'relative flex h-10 w-full select-none items-center justify-center text-base tabular-nums transition-colors duration-150',
                  isHandle &&
                    'z-[5] cursor-grab touch-none rounded-[10px] bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-bold text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] active:cursor-grabbing',
                  inside && 'bg-[#2f3138] font-semibold text-foreground',
                  !isHandle &&
                    !inside &&
                    'font-medium text-muted-foreground/40 hover:text-muted-foreground',
                )}
              >
                {formatUsd(p, 0)}
              </button>
            );
          })}

          {/* Range band frame + grab-tabs. */}
          {mode === 'range' && upperIdx >= 0 && lowerIdx >= upperIdx ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-10"
              style={{ top: upperIdx * ROW_H, height: (lowerIdx - upperIdx + 1) * ROW_H }}
            >
              <div className="absolute -inset-x-1 inset-y-0 rounded-xl border-2 border-[#3b82f6]/90" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
