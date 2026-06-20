'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Kamino-Multiply-style projection. NOT a live feature — leverage ships on
 * mainnet via `deepbook_margin`. Everything here is an illustrative projection
 * off the vault's base APY, clearly labelled so it can't be mistaken for a
 * working borrow. Math: net APY = base·L − borrowAPR·(L−1); a 1× position has
 * no debt and no liquidation. Liquidation buffer ≈ the PLP-NAV drop that wipes
 * equity at leverage L (≈ 1/L).
 */
const BORROW_APR = 8; // assumed dUSDC borrow rate on deepbook_margin, labelled below
const MODELED_BASE_APY = 14; // fallback when live APY isn't established yet (matches stated target)

export function LeverageProjection({ apyPct }: { apyPct: number | null }) {
  const [leverage, setLeverage] = useState(2);

  const isLive = apyPct !== null && apyPct > 0 && apyPct <= 60;
  const base = isLive ? (apyPct as number) : MODELED_BASE_APY;

  const netApy = base * leverage - BORROW_APR * (leverage - 1);
  const borrowDrag = BORROW_APR * (leverage - 1);
  const liqBufferPct = leverage <= 1 ? null : 100 / leverage;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Multiply</CardTitle>
        <Badge variant="outline" className="text-muted-foreground">
          Projection · not live
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Leverage</span>
          <span className="text-2xl font-semibold tabular-nums">{leverage.toFixed(2)}×</span>
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.25}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          aria-label="Leverage multiplier"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>1×</span>
          <span>3×</span>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <p className="text-sm text-muted-foreground">Projected net APY</p>
          <p
            className={cn(
              'text-3xl font-semibold tracking-tight tabular-nums',
              netApy >= 0 ? 'text-positive' : 'text-negative',
            )}
          >
            {formatPct(netApy, false)}
          </p>
        </div>

        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              Base PLP APY {isLive ? '(live)' : '(modeled)'}
            </dt>
            <dd className="tabular-nums">{formatPct(base, false)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Borrow cost ({BORROW_APR}% APR)</dt>
            <dd className="tabular-nums text-negative">−{borrowDrag.toFixed(2)}%</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Liquidation buffer</dt>
            <dd className="tabular-nums">
              {liqBufferPct === null ? 'No debt' : `NAV −${liqBufferPct.toFixed(0)}%`}
            </dd>
          </div>
        </dl>

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Illustrative projection from backtested economics. On mainnet, the loop ships via{' '}
          <span className="font-medium text-foreground">deepbook_margin</span>: borrow dUSDC
          against your pfShare and amplify PLP yield. Not enabled on testnet.
        </p>
      </CardContent>
    </Card>
  );
}
