'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const ROW_H = 44; // px — keep in sync with h-11 on rows
const HALF_SPAN = 10_000; // ladder spans spot ± this
const EDGE_ZONE = 40; // px from the ladder edge where dragging auto-scrolls
const EDGE_SCROLL_SPEED = 7; // px per frame while the pointer sits in the edge zone

/*
 * DeepBook-Predict-style vertical price wheel for range bets. The ladder runs
 * spot ± $10k on the tick grid; the selected band is a continuous charcoal
 * block framed in blue, bounded by two blue handle rows with grab-tabs that
 * stick out past the frame. Drag a handle (snaps row-to-row, auto-scrolls at
 * the edges) or tap any row to move the nearest handle there. The ladder
 * scrolls; dragging never scrolls.
 */
export function RangeLadder({
  spot,
  step,
  minStrike,
  lower,
  upper,
  onChange,
  className,
}: {
  spot: number;
  step: number;
  minStrike: number;
  lower: number;
  upper: number;
  onChange: (lower: number, upper: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'upper' | 'lower' | null>(null);
  const pointerY = useRef<number | null>(null);

  // Ladder prices, highest first (top of the ladder = highest strike).
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
  const upperIdx = (topPrice - upper) / step;
  const lowerIdx = (topPrice - lower) / step;

  const priceAtY = (clientY: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top + el.scrollTop) / ROW_H);
    if (idx < 0 || idx >= prices.length) return null;
    return topPrice - idx * step;
  };

  const moveHandle = (which: 'upper' | 'lower', price: number) => {
    if (which === 'upper') {
      if (price >= lower + step && price <= topPrice) onChange(lower, price);
    } else {
      if (price <= upper - step && price >= Math.max(minStrike, prices[prices.length - 1] ?? 0))
        onChange(price, upper);
    }
  };

  const startDrag = (which: 'upper' | 'lower', e: React.PointerEvent) => {
    e.preventDefault();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    pointerY.current = e.clientY;
    setDragging(which);
  };

  // While dragging near the top/bottom edge, keep scrolling and dragging the
  // handle along — pointermove alone stalls when the pointer holds still.
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

  // Center the band on mount and whenever the market grid changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prices.length === 0) return;
    const mid = (upper + lower) / 2;
    const idx = (topPrice - mid) / step;
    el.scrollTop = idx * ROW_H - el.clientHeight / 2 + ROW_H / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topPrice, step]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-[29rem] overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-[#0d0f14] bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] px-2 [background-size:28px_28px] [scrollbar-width:thin]',
        className,
      )}
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
          const isUpper = p === upper;
          const isLower = p === lower;
          const isHandle = isUpper || isLower;
          const inside = p < upper && p > lower;
          return (
            <button
              key={p}
              type="button"
              aria-label={
                isUpper ? `Upper bound ${p}` : isLower ? `Lower bound ${p}` : `Set bound to ${p}`
              }
              onPointerDown={(e) => {
                if (isHandle) startDrag(isUpper ? 'upper' : 'lower', e);
              }}
              onClick={() => {
                if (isHandle) return;
                // Tap: move the nearest handle to this row.
                if (p > upper) moveHandle('upper', p);
                else if (p < lower) moveHandle('lower', p);
                else if (upper - p <= p - lower) moveHandle('upper', p);
                else moveHandle('lower', p);
              }}
              className={cn(
                'relative flex h-11 w-full select-none items-center justify-center text-lg tabular-nums transition-colors duration-150',
                isHandle &&
                  'z-[5] cursor-grab touch-none bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-bold text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] active:cursor-grabbing',
                isUpper && 'rounded-t-[10px]',
                isLower && 'rounded-b-[10px]',
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

        {/* Blue frame around the band + grab-tabs sticking out past it. */}
        {upperIdx >= 0 && lowerIdx >= upperIdx ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10"
            style={{ top: upperIdx * ROW_H, height: (lowerIdx - upperIdx + 1) * ROW_H }}
          >
            <div className="absolute -inset-x-1 inset-y-0 rounded-xl border-2 border-[#3b82f6]/90" />
            <div
              onPointerDown={(e) => startDrag('upper', e)}
              className="pointer-events-auto absolute -top-3 left-1/2 flex h-5 w-16 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-md bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] active:cursor-grabbing"
            >
              <span className="h-0.5 w-7 rounded-full bg-white/80" />
            </div>
            <div
              onPointerDown={(e) => startDrag('lower', e)}
              className="pointer-events-auto absolute -bottom-3 left-1/2 flex h-5 w-16 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-md bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] active:cursor-grabbing"
            >
              <span className="h-0.5 w-7 rounded-full bg-white/80" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
