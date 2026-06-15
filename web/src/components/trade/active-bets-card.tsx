'use client';

import { ArrowDown, ArrowUp, RotateCw, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Countdown } from '@/components/countdown';
import { cn } from '@/lib/utils';
import { formatNumber, formatUsd } from '@/lib/format';
import { describeBet, liveValue } from '@/lib/bet-math';
import { usePositions } from '@/lib/use-positions';
import { useCashout, usePlaceBet, useWithdrawBalance } from '@/lib/use-place-bet';
import { atmStrike } from '@/components/trade/quick-bet-panel';
import { binaryUpProbability } from '@/lib/svi';
import type { BetPosition, LiveMarket } from '@/lib/types';

// Don't roll into a market about to freeze; mirror the bet panel's closing buffer.
const ROLL_BUFFER_MS = 30_000;

/** Soonest open market to roll into. (Single-asset testnet: positions carry no
 *  pair, so we target the nearest live oracle.) */
function nextOpenMarket(markets?: LiveMarket[]): LiveMarket | undefined {
  if (!markets) return undefined;
  const now = Date.now();
  return [...markets].sort((a, b) => a.expiry - b.expiry).find((m) => m.expiry - now > ROLL_BUFFER_MS);
}

function DirectionIcon({ direction }: { direction: BetPosition['direction'] }) {
  return direction === 'UP' ? (
    <ArrowUp className="size-4 shrink-0 text-positive" />
  ) : (
    <ArrowDown className="size-4 shrink-0 text-negative" />
  );
}

function StakeLine({ p }: { p: BetPosition }) {
  return (
    <span>
      {p.stakeUsd !== null ? `Stake ${formatNumber(p.stakeUsd)}` : 'Stake —'}
      {' → Win '}
      <span className="text-foreground">{formatNumber(p.units)} dUSDC</span>
    </span>
  );
}

export function ActiveBetsCard({ markets }: { markets?: LiveMarket[] }) {
  const positions = usePositions();
  const cashout = useCashout();
  const withdraw = useWithdrawBalance();
  const placeBet = usePlaceBet();
  const all = positions.data?.positions ?? [];
  const balance = positions.data?.managerBalanceUsd ?? 0;

  // Re-enter the same up/down view at ATM on the next open expiry, same stake.
  const rollTarget = nextOpenMarket(markets);
  const handleRoll = (p: BetPosition) => {
    if (!rollTarget) {
      toast.error('No open market to roll into yet — try again in a moment.');
      return;
    }
    if (!p.stakeUsd || p.stakeUsd <= 0) {
      toast.error('Original stake unknown — place this one manually.');
      return;
    }
    const strike = atmStrike(rollTarget);
    const pUp = rollTarget.svi ? binaryUpProbability(rollTarget.forward, strike, rollTarget.svi) : 0.5;
    const pWin = p.direction === 'UP' ? pUp : 1 - pUp;
    placeBet.mutate({ market: rollTarget, direction: p.direction, strikeUsd: strike, stakeUsd: p.stakeUsd, pWin });
  };

  if (all.length === 0 && balance < 0.01) return null;

  const active = all.filter((p) => p.status === 'active');
  const settled = all.filter((p) => p.status === 'settled');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Active Bets · {active.length}</CardTitle>
      </CardHeader>
      <CardContent className="max-h-80 space-y-3 overflow-y-auto">
        {active.map((p, i) => {
          const value = liveValue(p, markets);
          return (
            <div key={`a-${i}`} className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <DirectionIcon direction={p.direction} />
                <span className="font-medium">{describeBet(p)}</span>
                <Countdown expiry={p.expiry} className="ml-auto" />
              </div>
              <div className="flex items-center justify-between pl-6 text-xs text-muted-foreground">
                <StakeLine p={p} />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs text-accent-foreground"
                  disabled={cashout.isPending}
                  onClick={() => cashout.mutate(p)}
                >
                  {cashout.isPending
                    ? 'Cashing out…'
                    : `Cash out${value !== null ? ` ~${formatNumber(value)}` : ''}`}
                </Button>
              </div>
            </div>
          );
        })}

        {settled.length > 0 ? (
          <>
            {active.length > 0 ? <Separator className="my-1" /> : null}
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settled
            </p>
            {settled.map((p, i) => (
              <div key={`s-${i}`} className={cn('space-y-1 text-sm', !p.won && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  {p.won ? (
                    <Trophy className="size-4 shrink-0 text-positive" />
                  ) : (
                    <DirectionIcon direction={p.direction} />
                  )}
                  <span className={cn('font-medium', !p.won && 'line-through')}>
                    {describeBet(p)}
                  </span>
                  <span
                    className={cn(
                      'ml-auto font-medium tabular-nums',
                      p.won ? 'text-positive' : 'text-muted-foreground',
                    )}
                  >
                    {p.won ? `+${formatNumber(p.units)}` : '0'} dUSDC
                  </span>
                </div>
                <div className="flex items-center justify-between pl-6 text-xs text-muted-foreground">
                  <StakeLine p={p} />
                  <div className="flex items-center gap-1.5">
                    {p.won ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs text-positive"
                        disabled={cashout.isPending}
                        onClick={() => cashout.mutate(p)}
                      >
                        {cashout.isPending ? 'Claiming…' : `Claim +${formatNumber(p.units)}`}
                      </Button>
                    ) : (
                      <span>
                        settled {p.settlementUsd !== null ? formatUsd(p.settlementUsd, 0) : ''}
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      disabled={placeBet.isPending || !rollTarget}
                      onClick={() => handleRoll(p)}
                      title="Re-enter the same view on the next expiry"
                    >
                      <RotateCw className="size-3" />
                      {placeBet.isPending ? 'Rolling…' : 'Roll'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {balance >= 0.01 ? (
          <>
            <Separator className="my-1" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Account balance{' '}
                <span className="font-medium text-positive">{formatNumber(balance)} dUSDC</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate(balance)}
              >
                {withdraw.isPending ? 'Withdrawing…' : 'Withdraw to wallet'}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
