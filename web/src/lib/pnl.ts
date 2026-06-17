import type { BetHistoryEntry } from '@/lib/types';

/** Selectable profit/loss time windows (mirrors the card's toggle order). */
export type PnlWindow = '1D' | '1W' | '1M' | '1Y' | 'YTD' | 'ALL';

export const PNL_WINDOWS: PnlWindow[] = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'];

const DAY = 86_400_000;
const SPANS: Record<Exclude<PnlWindow, 'YTD' | 'ALL'>, number> = {
  '1D': DAY,
  '1W': 7 * DAY,
  '1M': 30 * DAY,
  '1Y': 365 * DAY,
};

const LABELS: Record<PnlWindow, string> = {
  '1D': 'Past Day',
  '1W': 'Past Week',
  '1M': 'Past Month',
  '1Y': 'Past Year',
  YTD: 'Year to Date',
  ALL: 'All Time',
};

export function windowLabel(w: PnlWindow): string {
  return LABELS[w];
}

/** Inclusive lower bound (unix ms) for a window measured from `now`. */
export function windowStartMs(w: PnlWindow, now: number): number {
  if (w === 'ALL') return 0;
  if (w === 'YTD') return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  return now - SPANS[w];
}

/**
 * Realized P/L for one bet, or null while it is still open. Net of stake:
 * a winning $1 stake that paid $1.80 contributes +0.80; a loss contributes
 * the negative stake. Attributed to the bet's placement time — the only
 * timestamp the on-chain history exposes per position.
 */
export function realizedPnl(b: BetHistoryEntry): number | null {
  if (b.outcome === 'open') return null;
  return (b.payoutUsd ?? 0) - b.stakeUsd;
}

export interface PnlSeries {
  /** Cumulative realized P/L over the window, oldest → newest, anchored at 0. */
  points: { t: number; pnl: number }[];
  /** Net realized P/L within the window (the series' final value). */
  total: number;
}

/** Cumulative realized-P/L curve for a window, anchored at 0 on the start edge. */
export function pnlSeries(bets: BetHistoryEntry[], w: PnlWindow, now: number): PnlSeries {
  const start = windowStartMs(w, now);
  const settled = bets
    .filter((b) => realizedPnl(b) !== null && b.timestampMs >= start)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const points: { t: number; pnl: number }[] = [{ t: start || (settled[0]?.timestampMs ?? now), pnl: 0 }];
  let running = 0;
  for (const b of settled) {
    running += realizedPnl(b)!;
    points.push({ t: b.timestampMs, pnl: running });
  }
  // Extend a flat segment to "now" so the line reaches the right edge.
  if (points[points.length - 1].t < now) points.push({ t: now, pnl: running });
  return { points, total: running };
}

/** Largest single-position profit across all history (0 when never up). */
export function biggestWinUsd(bets: BetHistoryEntry[]): number {
  return bets.reduce((max, b) => {
    const net = realizedPnl(b);
    return net !== null && net > max ? net : max;
  }, 0);
}
