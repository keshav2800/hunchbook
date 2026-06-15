'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/sparkline';
import { Countdown } from '@/components/countdown';
import { cn } from '@/lib/utils';
import { formatPct, formatUsd } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds } from '@/lib/svi';
import type { LiveMarket } from '@/lib/types';

export function marketOdds(market: LiveMarket): { up: number; down: number; pUp: number } {
  if (!market.svi) return { up: 0, down: 0, pUp: 0.5 };
  // ATM quote: strike at spot rounded to the oracle's tick size
  const strike = Math.round(market.spot / market.tickSize) * market.tickSize;
  const pUp = binaryUpProbability(market.forward, strike, market.svi);
  return { up: probabilityToOdds(pUp), down: probabilityToOdds(1 - pUp), pUp };
}

export function expiryLabel(market: LiveMarket): string {
  return new Date(market.expiry).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function MarketCard({
  market,
  onSelect,
}: {
  market: LiveMarket;
  onSelect: (oracleId: string) => void;
}) {
  const positive = market.sessionChangePct >= 0;
  const odds = marketOdds(market);
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-ring/50"
      onClick={() => onSelect(market.oracleId)}
    >
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {market.pair} — {expiryLabel(market)}
          </span>
          <Countdown expiry={market.expiry} />
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold">{formatUsd(market.spot)}</span>
          <span className={cn('text-sm font-medium', positive ? 'text-positive' : 'text-negative')}>
            {formatPct(market.sessionChangePct)}
          </span>
        </div>
        <Sparkline data={market.sparkline} positive={positive} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-positive/40 text-positive hover:bg-positive/10"
          >
            UP {odds.up.toFixed(2)}x
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-negative/40 text-negative hover:bg-negative/10"
          >
            DOWN {odds.down.toFixed(2)}x
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
