'use client';

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Bitcoin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Countdown } from '@/components/countdown';
import { expiryTabLabel } from '@/components/trade/expiry-tabs';
import { RANGE_STEP } from '@/components/trade/quick-bet-panel';
import { binaryUpProbability, probabilityToOdds, rangeProbability, sviTotalVariance } from '@/lib/svi';
import { formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LiveMarket } from '@/lib/types';

// One-tap selection from the board → loads into the hero chart + Quick Bet panel.
export type BoardPick =
  | { oracleId: string; tab: 'ABOVE' | 'BELOW'; strike: number }
  | { oracleId: string; tab: 'RANGE'; band: { low: number; high: number } };

const baseSymbol = (pair: string) => pair.split('/')[0];
const kfmt = (n: number) => `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;

/** Derive the three framings (up/down, above-strikes, range-bands) from one market's SVI. */
function plays(m: LiveMarket, svi: NonNullable<LiveMarket['svi']>) {
  const f = m.forward;
  const tick = m.tickSize;
  const atm = Math.round(m.spot / tick) * tick;
  const pUp = binaryUpProbability(f, atm, svi);

  // 1σ of the log-return over THIS expiry (from the ATM total variance). Strikes
  // and bands scale by it, so a 13-min market and a weekly one both get sensible
  // odds instead of unreachable round-number strikes that price to 0.00x.
  const sd = Math.sqrt(Math.max(sviTotalVariance(0, svi), 1e-12));
  const move = Math.max(f * sd, tick); // ~1σ in dollars
  const unit = Math.max(tick, Math.pow(10, Math.floor(Math.log10(Math.max(move, 1)))));
  const snap = (x: number) => Math.round(x / unit) * unit;

  // "Above" strikes near +0.25σ / +0.6σ / +0.95σ (≈ 40% / 27% / 17% to hit).
  const above: { strike: number; odds: number }[] = [];
  let prev = Math.floor(f / unit) * unit;
  for (const c of [0.25, 0.6, 0.95]) {
    let s = Math.max(snap(f * Math.exp(c * sd)), m.minStrike);
    if (s <= prev) s = prev + unit;
    above.push({ strike: s, odds: probabilityToOdds(binaryUpProbability(f, s, svi)) });
    prev = s;
  }

  // Two range bands centred on spot: a tighter one and a wider one. Width is
  // ~±0.6σ snapped to the ladder grid (floored at one step), and the second is
  // always wider, so on a quiet (low-σ) market they never collapse into one.
  const center = Math.round(f / RANGE_STEP) * RANGE_STEP;
  const baseHalf = Math.max(RANGE_STEP, Math.round((f * 0.6 * sd) / RANGE_STEP) * RANGE_STEP);
  const mkBand = (half: number) => {
    const low = Math.max(m.minStrike, center - half);
    const high = center + half;
    return { low, high, odds: probabilityToOdds(rangeProbability(f, low, high, svi)) };
  };
  const bands = [
    mkBand(baseHalf),
    mkBand(baseHalf + RANGE_STEP * 2),
    mkBand(baseHalf + RANGE_STEP * 4),
  ];

  return { atm, pUp, upOdds: probabilityToOdds(pUp), downOdds: probabilityToOdds(1 - pUp), above, bands };
}

function BtcChip({ symbol }: { symbol: string }) {
  return symbol === 'BTC' ? (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#f7931a]">
      <Bitcoin className="size-3.5 text-white" />
    </span>
  ) : (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
      {symbol.slice(0, 1)}
    </span>
  );
}

function Gauge({ pct }: { pct: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct / 100)) * c;
  return (
    <div className="relative size-11 shrink-0">
      <svg viewBox="0 0 36 36" className="size-11 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="#4da2ff"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold tabular-nums">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

function CardShell({
  title,
  symbol,
  expiry,
  right,
  children,
}: {
  title: string;
  symbol: string;
  expiry: number;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-2">
          <BtcChip symbol={symbol} />
          <span className="text-sm font-semibold">{title}</span>
          {right ? <span className="ml-auto">{right}</span> : null}
        </div>
        <div className="flex-1">{children}</div>
        <div className="flex items-center justify-between border-t border-white/10 pt-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-negative" /> Live
          </span>
          <Countdown expiry={expiry} />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, odds, onClick }: { label: string; odds: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-white/5"
    >
      <span className="font-medium tabular-nums">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono font-semibold tabular-nums text-positive">{odds.toFixed(2)}x</span>
        <ArrowRight className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
    </button>
  );
}

export function MarketsBoard({
  markets,
  defaultOracleId,
  onPick,
}: {
  markets: LiveMarket[];
  defaultOracleId?: string;
  onPick: (p: BoardPick) => void;
}) {
  // Soonest few still-open expiries, one chip per distinct expiry (the gateway
  // can return duplicates and already-expired markets).
  const now = Date.now();
  const future = [...markets].filter((x) => x.expiry > now).sort((a, b) => a.expiry - b.expiry);
  const open = future.filter((x, i) => future.findIndex((y) => y.expiry === x.expiry) === i).slice(0, 6);
  const [sel, setSel] = useState<string | undefined>(defaultOracleId);
  const m = open.find((x) => x.oracleId === sel) ?? open.find((x) => x.oracleId === defaultOracleId) ?? open[0];

  const header = (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Markets</h2>
      {open.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {open.map((x) => {
            const active = x.oracleId === m?.oracleId;
            return (
              <button
                key={x.oracleId}
                type="button"
                onClick={() => setSel(x.oracleId)}
                className={cn(
                  'h-8 rounded-lg border px-2.5 font-mono text-xs uppercase tracking-wider transition-colors',
                  active
                    ? 'border-transparent bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]'
                    : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35] hover:text-foreground',
                )}
              >
                {expiryTabLabel(x.expiry)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  if (!m || !m.svi) {
    return (
      <section className="space-y-3">
        {header}
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </section>
    );
  }

  const p = plays(m, m.svi);
  const sym = baseSymbol(m.pair);

  return (
    <section className="space-y-3">
      {header}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Up or Down */}
        <CardShell title={`${sym} · Up or Down`} symbol={sym} expiry={m.expiry} right={<Gauge pct={p.pUp * 100} />}>
          <div className="flex h-full flex-col">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onPick({ oracleId: m.oracleId, tab: 'ABOVE', strike: p.atm })}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-positive/40 py-3 text-sm font-semibold text-positive transition-colors hover:bg-positive/10"
              >
                <ArrowUp className="size-4" /> Up
                <span className="font-mono tabular-nums">{p.upOdds.toFixed(2)}x</span>
              </button>
              <button
                type="button"
                onClick={() => onPick({ oracleId: m.oracleId, tab: 'BELOW', strike: p.atm })}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-negative/40 py-3 text-sm font-semibold text-negative transition-colors hover:bg-negative/10"
              >
                <ArrowDown className="size-4" /> Down
                <span className="font-mono tabular-nums">{p.downOdds.toFixed(2)}x</span>
              </button>
            </div>
            <p className="mt-auto pt-4 text-xs text-muted-foreground">
              Will {sym} be above {formatUsd(p.atm, 0)} at expiry?
            </p>
          </div>
        </CardShell>

        {/* Will BTC go above? */}
        <CardShell title={`Will ${sym} go above?`} symbol={sym} expiry={m.expiry}>
          <div className="-mx-1 space-y-0.5">
            {p.above.map((a) => (
              <Row
                key={a.strike}
                label={formatUsd(a.strike, 0)}
                odds={a.odds}
                onClick={() => onPick({ oracleId: m.oracleId, tab: 'ABOVE', strike: a.strike })}
              />
            ))}
          </div>
        </CardShell>

        {/* Stays in a range */}
        <CardShell title={`${sym} stays in a range?`} symbol={sym} expiry={m.expiry}>
          <div className="-mx-1 space-y-0.5">
            {p.bands.map((b, i) => (
              <Row
                key={i}
                label={`${kfmt(b.low)} to ${kfmt(b.high)}`}
                odds={b.odds}
                onClick={() => onPick({ oracleId: m.oracleId, tab: 'RANGE', band: { low: b.low, high: b.high } })}
              />
            ))}
          </div>
        </CardShell>
      </div>
    </section>
  );
}
