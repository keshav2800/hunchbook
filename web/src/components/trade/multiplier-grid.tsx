'use client';

import { useMemo } from 'react';
import { binaryUpProbability, probabilityToOdds } from '@/lib/svi';
import { formatNumber, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BetPosition, LiveMarket } from '@/lib/types';
import type { Tab } from '@/components/trade/quick-bet-panel';

// Matches theme.css --primary / --foreground. SVG paints to pixels and can't
// read CSS vars, so the same values the PredictionChart uses are inlined here.
const PRIMARY = '#4da2ff';
const PRIMARY_RGB = '77, 162, 255';
const FG_RGB = '234, 242, 255';

const ROWS_PER_SIDE = 6; // strike rows above and below spot → 13 total
const HEADER_H = 44; // px column-header band above the rows
const LABEL_W = 68; // px strike-label rail between the chart and the columns

/** A "nice" 1/2/5×10^k strike spacing so ~13 rows span a sensible band. */
function niceStep(spot: number): number {
  const raw = spot * 0.0008;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nice * pow;
}

/** Payout multiple in the reference's compact form: 186x / 12.4x / 3.45x. */
function formatMult(m: number): string {
  if (m >= 100) return `${Math.round(m)}x`;
  if (m >= 10) return `${m.toFixed(1)}x`;
  return `${m.toFixed(2)}x`;
}

/** Compact clock label for a column header, e.g. "2:15 PM". */
function clockLabel(expiry: number): string {
  return new Date(expiry).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Time-to-expiry in one short token: 8m / 3h / 5d. The only relative info a
 *  bettor needs at a glance — no seconds churn, no second line. */
function relLabel(expiry: number): string {
  const ms = expiry - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Light centred moving-average to calm tick noise into gentle waves. The last
 *  sample is left exact so the live dot still lands on the real latest price. */
function smoothSeries(v: number[], window: number): number[] {
  if (v.length < 3) return v;
  const half = Math.floor(window / 2);
  return v.map((_, i) => {
    if (i === v.length - 1) return v[i];
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(v.length - 1, i + half); j++) {
      sum += v[j];
      count++;
    }
    return sum / count;
  });
}

/** Catmull-Rom → cubic-bezier path so the line flows in curves, not zig-zags. */
function flowingPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/*
 * The multiplier grid: a denser, tappable view over the *same* binary markets
 * the chart sells. Rows are strikes, columns are live expiries, each cell is the
 * payout multiple (probabilityToOdds(binaryUpProbability)) for "BTC above/below
 * this strike by this expiry". A tap loads that strike + expiry into the shared
 * bet state, exactly like dragging the strike line does. The left price line and
 * the grid share one linear price axis, so the spot line is continuous across.
 */
export function MultiplierGrid({
  markets,
  spot,
  chartSpots,
  bets = [],
  selectedOracleId,
  selectedStrike,
  onPick,
  maxCols = 8,
  className,
}: {
  markets: LiveMarket[];
  spot: number;
  chartSpots: number[];
  // Active positions — each is marked on the grid at its strike row × expiry col.
  bets?: BetPosition[];
  selectedOracleId?: string;
  selectedStrike?: number;
  onPick: (oracleId: string, strike: number, tab: Tab) => void;
  // Only the nearest few expiries are shown — the far ones all pay ~1× and just
  // crowd the grid. Fewer on mobile so cells keep room to breathe.
  maxCols?: number;
  className?: string;
}) {
  const cols = useMemo(
    () => [...markets].sort((a, b) => a.expiry - b.expiry).slice(0, maxCols),
    [markets, maxCols],
  );

  // Strike rows: clean `step` marks centred on spot, top → bottom (descending).
  const { rows, step, pTop, pBottom } = useMemo(() => {
    const s = niceStep(spot);
    const center = Math.round(spot / s) * s;
    const all: number[] = [];
    for (let i = ROWS_PER_SIDE; i >= -ROWS_PER_SIDE; i--) all.push(center + i * s);
    const r = all.filter((k) => k > 0);
    return { rows: r, step: s, pTop: r[0] + s / 2, pBottom: r[r.length - 1] - s / 2 };
  }, [spot]);

  // Positions are fractions of the body height (0 = top edge, 1 = bottom edge),
  // so the grid stretches to fill whatever height the card hands it.
  const priceToFrac = (p: number) =>
    Math.max(0, Math.min(1, (pTop - p) / (pTop - pBottom)));

  // Multiplier matrix, per column (market) × row (strike). Above spot bets
  // ABOVE (BTC > strike); at/below spot bets BELOW (BTC < strike). null where
  // the oracle has no SVI fit, or the strike is so far the payout rounds out.
  const matrix = useMemo(
    () =>
      cols.map((m) =>
        rows.map((k) => {
          if (!m.svi) return null;
          const above = k > spot;
          const pUp = binaryUpProbability(m.forward, k, m.svi);
          const mult = probabilityToOdds(above ? pUp : 1 - pUp);
          if (mult <= 0) return null;
          return { mult, tab: (above ? 'ABOVE' : 'BELOW') as Tab };
        }),
      ),
    [cols, rows, spot],
  );

  // Price line in a normalised 0..1000 × 0..1000 viewBox, stretched to fill the
  // body box (preserveAspectRatio="none"), so it tracks the rows at any height.
  const linePts = useMemo(() => {
    const total = chartSpots.length;
    if (total < 2) return null;
    // Only the recent tail — the line should read as live movement, not a long
    // historical squiggle. The kept window then spans the full panel width.
    const keep = Math.max(20, Math.ceil(total * 0.4));
    const recent = chartSpots.slice(-keep);
    const n = recent.length;
    const smooth = smoothSeries(recent, 5);
    const pts = smooth.map((v, i) => ({ x: (i / (n - 1)) * 1000, y: priceToFrac(v) * 1000 }));
    const line = flowingPath(pts);
    return { line, area: `${line} L1000 1000 L0 1000 Z`, lastFrac: pts[pts.length - 1].y / 1000 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartSpots, pTop, pBottom]);

  const gridCols = { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` };
  const gridRows = { gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` };
  const spotFrac = priceToFrac(spot);

  // Faint grid behind the price line, with horizontals on the strike-row
  // boundaries so it reads as one continuous grid with the columns on the right.
  const bgGrid = useMemo(() => {
    const segs: string[] = [];
    for (let i = 0; i <= rows.length; i++) {
      const y = ((i / rows.length) * 1000).toFixed(1);
      segs.push(`M0 ${y} L1000 ${y}`);
    }
    const verticals = 5;
    for (let i = 1; i < verticals; i++) {
      const x = ((i / verticals) * 1000).toFixed(1);
      segs.push(`M${x} 0 L${x} 1000`);
    }
    return segs.join(' ');
  }, [rows.length]);

  // Place each active bet on the grid: its expiry picks the column, its strike
  // picks the spot on the price axis. Bets on off-screen expiries, or with no
  // reconstructed stake, are dropped.
  const betMarkers = useMemo(
    () =>
      bets.flatMap((b) => {
        const ci = cols.findIndex((c) => c.oracleId === b.oracleId);
        if (ci < 0 || b.stakeUsd == null || b.stakeUsd <= 0) return [];
        return [
          {
            key: `${b.oracleId}-${b.strikeUsd}-${b.direction}`,
            leftPct: ((ci + 0.5) / cols.length) * 100,
            topFrac: priceToFrac(b.strikeUsd),
            stake: b.stakeUsd,
            mult: b.units / b.stakeUsd,
            direction: b.direction,
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bets, cols, pTop, pBottom],
  );

  return (
    <div className={cn('flex h-full select-none', className)}>
      {/* Left: blue price line + fading blue area, sharing the row price axis.
          A slim strip on phones; the roomier 32% from sm up. */}
      <div className="relative flex shrink-0 basis-[20%] flex-col sm:basis-[32%]" style={{ paddingTop: HEADER_H }}>
        <div className="relative flex-1">
          {linePts ? (
            <>
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="absolute inset-0"
              >
                <defs>
                  <linearGradient id="hb-grid-fade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d={bgGrid}
                  fill="none"
                  stroke={`rgba(${FG_RGB}, 0.07)`}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <path d={linePts.area} fill="url(#hb-grid-fade)" />
                <path
                  d={linePts.line}
                  fill="none"
                  stroke={PRIMARY}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {/* live dot at the line's leading edge, meeting the spot pill */}
              <span
                className="absolute size-2.5 -translate-y-1/2 rounded-full bg-primary"
                style={{ top: `${(linePts.lastFrac * 100).toFixed(2)}%`, right: -2, boxShadow: `0 0 0 4px rgba(${PRIMARY_RGB}, 0.18)` }}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Right: strike-label rail + the multiplier columns, with the spot line. */}
      <div className="relative flex h-full min-w-0 flex-1">
        {/* strike-label rail */}
        <div className="flex shrink-0 flex-col" style={{ width: LABEL_W }}>
          <div className="shrink-0" style={{ height: HEADER_H }} />
          <div className="flex flex-1 flex-col">
            {rows.map((k) => (
              <div
                key={k}
                className="flex flex-1 items-center justify-end border-b border-white/10 pr-3 font-mono text-xs tabular-nums text-muted-foreground"
              >
                {formatUsd(k, 0).replace('$', '')}
              </div>
            ))}
          </div>
        </div>

        {/* multiplier columns */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="grid shrink-0 border-l border-t border-white/10" style={{ ...gridCols, height: HEADER_H }}>
            {cols.map((m) => (
              <div
                key={m.oracleId}
                className="flex flex-col items-center justify-center gap-0.5 overflow-hidden border-b border-r border-white/10 px-1"
              >
                <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-foreground">
                  {clockLabel(m.expiry)}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {relLabel(m.expiry)}
                </span>
              </div>
            ))}
          </div>
          <div className="grid flex-1 border-l border-white/10" style={{ ...gridCols, ...gridRows }}>
            {rows.map((k, ri) =>
              cols.map((m, ci) => {
                const cell = matrix[ci][ri];
                const selected =
                  m.oracleId === selectedOracleId &&
                  selectedStrike != null &&
                  Math.abs(k - selectedStrike) < step / 2;
                if (!cell) {
                  return (
                    <div
                      key={`${m.oracleId}-${k}`}
                      className="flex items-center justify-center border-b border-r border-white/10 text-xs text-muted-foreground/40"
                    >
                      —
                    </div>
                  );
                }
                // brighter text for the rarer, higher-paying cells.
                const t = Math.min(
                  1,
                  Math.max(0, (Math.log(cell.mult) - Math.log(2)) / (Math.log(150) - Math.log(2))),
                );
                return (
                  <button
                    key={`${m.oracleId}-${k}`}
                    type="button"
                    onClick={() => onPick(m.oracleId, k, cell.tab)}
                    style={{ color: `rgba(${FG_RGB}, ${(0.4 + 0.6 * t).toFixed(2)})` }}
                    className={cn(
                      'flex items-center justify-center overflow-hidden border-b border-r border-white/10 px-1 font-mono text-xs tabular-nums transition-colors hover:bg-white/[0.04]',
                      selected && 'bg-primary/15 ring-1 ring-inset ring-primary/60',
                    )}
                  >
                    {formatMult(cell.mult)}
                  </button>
                );
              }),
            )}
          </div>

          {/* Active-bet markers, overlaid on the body at each bet's column +
              strike — the glowing chip the reference uses, in our blue. */}
          {betMarkers.length > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: HEADER_H, bottom: 0 }}>
              {betMarkers.map((b) => (
                <div
                  key={b.key}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-md px-2 py-0.5 font-mono leading-none"
                  style={{
                    left: `${b.leftPct}%`,
                    top: `${(b.topFrac * 100).toFixed(2)}%`,
                    background: PRIMARY,
                    color: '#02101f',
                    boxShadow: `0 0 18px rgba(${PRIMARY_RGB}, 0.55)`,
                  }}
                >
                  <span className="text-sm font-bold tabular-nums">${formatNumber(b.stake)}</span>
                  <span className="mt-0.5 text-[10px] font-semibold tabular-nums opacity-80">
                    {formatMult(b.mult)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* spot line + pill — overlaid across the rail + columns, blue dashed,
            the same handle styling the chart uses. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-10"
          style={{ top: `calc(${HEADER_H}px + (100% - ${HEADER_H}px) * ${spotFrac.toFixed(4)})` }}
        >
          <div className="relative border-t border-dashed border-primary/70">
            <div
              className="absolute -top-3 left-1 flex h-6 items-center gap-1.5 rounded-md border bg-[#0d1523] px-2 font-mono text-xs font-semibold tabular-nums shadow-lg"
              style={{ borderColor: `rgba(${PRIMARY_RGB}, 0.5)`, color: PRIMARY }}
            >
              <span className="h-2.5 w-0.5 rounded-full" style={{ background: `rgba(${PRIMARY_RGB}, 0.7)` }} />
              {formatUsd(spot, 0).replace('$', '')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
