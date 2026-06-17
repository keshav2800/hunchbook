'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const COL_W = 76; // px — width of each price cell (mirrors ROW_H in the vertical ladder)
const HALF_SPAN = 10_000; // ladder spans spot ± this
const EDGE_ZONE = 44; // px from the ladder edge where dragging auto-scrolls
const EDGE_SCROLL_SPEED = 9; // px per frame while the pointer sits in the edge zone

/*
 * The vertical RangeLadder, laid on its side for small screens. Same anatomy —
 * a price strip on the tick grid, the selected band a continuous charcoal block
 * framed in blue, bounded by two blue handle cells with grab-tabs that stick out
 * past the frame — but it runs left (low) → right (high) and scrolls
 * horizontally. Drag a handle (snaps cell-to-cell, auto-scrolls at the edges) or
 * tap any cell to move the nearest handle there.
 */
export function RangeLadderHorizontal({
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
  const pointerX = useRef<number | null>(null);

  // Ladder prices, lowest first (left of the ladder = lowest strike).
  const prices = useMemo(() => {
    const cellsEachSide = Math.round(HALF_SPAN / step);
    const center = Math.round(spot / step) * step;
    const list: number[] = [];
    for (let i = -cellsEachSide; i <= cellsEachSide; i++) {
      const p = center + i * step;
      if (p >= Math.max(minStrike, step)) list.push(p);
    }
    return list;
  }, [spot, step, minStrike]);

  const leftPrice = prices[0] ?? 0;
  const rightPrice = prices[prices.length - 1] ?? 0;
  const lowerIdx = (lower - leftPrice) / step;
  const upperIdx = (upper - leftPrice) / step;

  const priceAtX = (clientX: number): number | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const idx = Math.floor((clientX - rect.left + el.scrollLeft) / COL_W);
    if (idx < 0 || idx >= prices.length) return null;
    return leftPrice + idx * step;
  };

  const moveHandle = (which: 'upper' | 'lower', price: number) => {
    if (which === 'upper') {
      if (price >= lower + step && price <= rightPrice) onChange(lower, price);
    } else {
      if (price <= upper - step && price >= leftPrice) onChange(price, upper);
    }
  };

  const startDrag = (which: 'upper' | 'lower', e: React.PointerEvent) => {
    e.preventDefault();
    containerRef.current?.setPointerCapture?.(e.pointerId);
    pointerX.current = e.clientX;
    setDragging(which);
  };

  // While dragging near the left/right edge, keep scrolling and dragging the
  // handle along — pointermove alone stalls when the pointer holds still.
  const dragTick = useRef<() => void>(() => {});
  dragTick.current = () => {
    const el = containerRef.current;
    const x = pointerX.current;
    if (!el || !dragging || x === null) return;
    const rect = el.getBoundingClientRect();
    if (x < rect.left + EDGE_ZONE) el.scrollLeft -= EDGE_SCROLL_SPEED;
    else if (x > rect.right - EDGE_ZONE) el.scrollLeft += EDGE_SCROLL_SPEED;
    else return;
    const price = priceAtX(x);
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
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prices.length === 0) return;
    const mid = (upper + lower) / 2;
    const idx = (mid - leftPrice) / step;
    el.scrollLeft = idx * COL_W - el.clientWidth / 2 + COL_W / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPrice, step]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-24 overflow-x-auto overflow-y-hidden overscroll-contain rounded-lg border border-white/10 bg-[#0d0f14] bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] py-2 [background-size:28px_28px] [scrollbar-width:thin]',
        className,
      )}
      onPointerMove={(e) => {
        pointerX.current = e.clientX;
        if (!dragging) return;
        const price = priceAtX(e.clientX);
        if (price !== null) moveHandle(dragging, price);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      <div className="relative flex h-full" style={{ width: prices.length * COL_W }}>
        {prices.map((p) => {
          const isLower = p === lower;
          const isUpper = p === upper;
          const isHandle = isUpper || isLower;
          const inside = p > lower && p < upper;
          return (
            <button
              key={p}
              type="button"
              style={{ width: COL_W }}
              aria-label={
                isUpper ? `Upper bound ${p}` : isLower ? `Lower bound ${p}` : `Set bound to ${p}`
              }
              onPointerDown={(e) => {
                if (isHandle) startDrag(isLower ? 'lower' : 'upper', e);
              }}
              onClick={() => {
                if (isHandle) return;
                // Tap: move the nearest handle to this cell.
                if (p > upper) moveHandle('upper', p);
                else if (p < lower) moveHandle('lower', p);
                else if (upper - p <= p - lower) moveHandle('upper', p);
                else moveHandle('lower', p);
              }}
              className={cn(
                'relative flex h-full shrink-0 select-none items-center justify-center text-sm tabular-nums transition-colors duration-150',
                isHandle &&
                  'z-[5] cursor-grab touch-none bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-bold text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] active:cursor-grabbing',
                isLower && 'rounded-l-[10px]',
                isUpper && 'rounded-r-[10px]',
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
        {lowerIdx >= 0 && upperIdx >= lowerIdx ? (
          <div
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{ left: lowerIdx * COL_W, width: (upperIdx - lowerIdx + 1) * COL_W }}
          >
            <div className="absolute inset-x-0 -inset-y-1 rounded-xl border-2 border-[#3b82f6]/90" />
            <div
              onPointerDown={(e) => startDrag('lower', e)}
              className="pointer-events-auto absolute -left-3 top-1/2 flex h-16 w-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-md bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] active:cursor-grabbing"
            >
              <span className="h-7 w-0.5 rounded-full bg-white/80" />
            </div>
            <div
              onPointerDown={(e) => startDrag('upper', e)}
              className="pointer-events-auto absolute -right-3 top-1/2 flex h-16 w-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-md bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] active:cursor-grabbing"
            >
              <span className="h-7 w-0.5 rounded-full bg-white/80" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
