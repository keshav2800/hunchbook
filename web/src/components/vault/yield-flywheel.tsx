'use client';

import { useEffect, useState } from 'react';
import { useMotionValueEvent, useSpring } from 'motion/react';
import { Activity, ChevronRight, Coins, Equal, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Interactive "you are the house" yield model. The single question every LP has
 * is *where does the APY come from* — so this lets them drag trading volume and
 * watch it flow into LP yield in real time.
 *
 * Honesty: the APY curve is anchored to the vault backtest (turnover scale 1×
 * → 2.2% APY, 10× → 24%), modelled on a reference $1M vault. The hedge is shown
 * as the small drag it actually is, then the 20% performance fee is carved out.
 * Nothing here claims "bettors lose" — yield is framed as market-making spread
 * on volume. Labelled "Illustrative model"; the live APY lives on the stat card.
 */
const REF_TVL = 1_000_000; // modelled vault size used to turn $ volume into turnover
const HEDGE_BUDGET = 0.02; // 2%/yr hedge spend (matches the backtest hedge wing)
const PERF_FEE = 0.2; // 20% performance fee

/** Gross PLP APY as a function of annual turnover, fit to the backtest anchors. */
function grossApyFromScale(scale: number): number {
  return 2.2 * scale * (1 + 0.01 * scale);
}

function formatVolume(v: number): string {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}K`;
}

/** Smoothly tweened number for the live-updating chips. */
function useTween(value: number): number {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  useMotionValueEvent(spring, 'change', (v) => setDisplay(v));
  return display;
}

function Step({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'result';
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col gap-1 rounded-lg border bg-card p-3',
        tone === 'result' && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums tracking-tight',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'result' && 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Arrow() {
  return (
    <ChevronRight className="hidden size-5 shrink-0 self-center text-muted-foreground md:block" />
  );
}

export function YieldFlywheel() {
  const [monthlyVolume, setMonthlyVolume] = useState(300_000);

  const scale = (monthlyVolume * 12) / REF_TVL;
  const grossApy = grossApyFromScale(scale);
  const hedgeDrag = grossApy * HEDGE_BUDGET;
  const afterHedge = grossApy - hedgeDrag;
  const perfFee = afterHedge * PERF_FEE;
  const netApy = afterHedge - perfFee;

  // Tweened display values.
  const tVolume = useTween(monthlyVolume);
  const tGross = useTween(grossApy);
  const tHedge = useTween(hedgeDrag);
  const tNet = useTween(netApy);

  // Decomposition bar — what share of gross yield ends up where.
  const netW = (netApy / grossApy) * 100;
  const feeW = (perfFee / grossApy) * 100;
  const hedgeW = (hedgeDrag / grossApy) * 100;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>How this vault earns</CardTitle>
        <Badge variant="outline" className="text-muted-foreground">
          Illustrative model
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Monthly trading volume</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatVolume(tVolume)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">/mo</span>
            </span>
          </div>
          <input
            type="range"
            min={80_000}
            max={1_200_000}
            step={20_000}
            value={monthlyVolume}
            onChange={(e) => setMonthlyVolume(Number(e.target.value))}
            aria-label="Monthly trading volume"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Quiet</span>
            <span>Busy</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
          <Step
            icon={<Activity className="size-3.5" />}
            label="Trading volume"
            value={`${formatVolume(tVolume)}/mo`}
          />
          <Arrow />
          <Step
            icon={<Coins className="size-3.5" />}
            label="PLP yield"
            value={`+${tGross.toFixed(1)}%`}
            tone="positive"
          />
          <Arrow />
          <Step
            icon={<Shield className="size-3.5" />}
            label="Hedge cost"
            value={`−${tHedge.toFixed(2)}%`}
            tone="negative"
          />
          <Arrow />
          <Step
            icon={<Equal className="size-3.5" />}
            label="Your APY"
            value={`${tNet.toFixed(1)}%`}
            tone="result"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-positive transition-[width] duration-500 ease-out"
              style={{ width: `${netW}%` }}
            />
            <div
              className="h-full bg-muted-foreground/40 transition-[width] duration-500 ease-out"
              style={{ width: `${feeW}%` }}
            />
            <div
              className="h-full bg-negative/60 transition-[width] duration-500 ease-out"
              style={{ width: `${hedgeW}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-positive" /> Your APY
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/40" /> 20% perf fee
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-negative/60" /> Hedge cost
            </span>
          </div>
        </div>

        <p className="border-t pt-3 text-xs text-muted-foreground">
          You provide the liquidity that powers the market — the same model as a perp/options
          liquidity pool, so yield scales with trading volume. Modelled on a $1M vault from
          backtested PLP economics; your live APY is shown above.
        </p>
      </CardContent>
    </Card>
  );
}
