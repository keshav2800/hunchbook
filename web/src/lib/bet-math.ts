import { binaryUpProbability } from '@/lib/svi';
import { formatUsd } from '@/lib/format';
import type { BetPosition, LiveMarket } from '@/lib/types';

export const EXPLORER_TX = 'https://suiscan.xyz/testnet/tx';

export function describeBet(p: Pick<BetPosition, 'direction' | 'strikeUsd'>): string {
  return `BTC ${p.direction === 'UP' ? '>' : '<'} ${formatUsd(p.strikeUsd, 0)}`;
}

/** Live cash-out estimate: win probability × $1-payout units. */
export function liveValue(
  p: Pick<BetPosition, 'oracleId' | 'direction' | 'strikeUsd' | 'units'>,
  markets?: LiveMarket[],
): number | null {
  const market = markets?.find((m) => m.oracleId === p.oracleId);
  if (!market?.svi) return null;
  const pUp = binaryUpProbability(market.forward, p.strikeUsd, market.svi);
  return (p.direction === 'UP' ? pUp : 1 - pUp) * p.units;
}

/**
 * Market value of held bet positions (excludes the manager's free cash):
 * live cash-out estimate for active bets, face value for claimable wins.
 */
export function positionsMarketValueUsd(
  positions: BetPosition[],
  markets?: LiveMarket[],
): number {
  return positions.reduce((acc, p) => {
    if (p.status === 'active') return acc + (liveValue(p, markets) ?? 0);
    return p.won ? acc + p.units : acc;
  }, 0);
}
