'use client';

import { positionsMarketValueUsd } from '@/lib/bet-math';
import { formatNumber } from '@/lib/format';
import { useLiveMarkets } from '@/lib/hooks';
import { useDusdcBalance } from '@/lib/use-place-bet';
import { useManagerId, usePositions } from '@/lib/use-positions';

/**
 * Formatted Portfolio and Cash readouts shared by the top nav (desktop pills)
 * and the account menu (mobile). `null` while loading, `'—'` on error.
 *   Portfolio = live value of held positions + the manager's free balance.
 *   Cash      = the wallet's dUSDC balance.
 */
export function useAccountReadouts() {
  const markets = useLiveMarkets();
  const managerId = useManagerId();
  const positions = usePositions();
  const balance = useDusdcBalance();

  let portfolio: string | null = null;
  if (managerId.isError || positions.isError) portfolio = '—';
  else if (managerId.data === null) portfolio = `$${formatNumber(0)}`;
  else if (positions.data) {
    const value =
      positionsMarketValueUsd(positions.data.positions, markets.data) +
      positions.data.managerBalanceUsd;
    portfolio = `$${formatNumber(value)}`;
  }

  const cash = balance.isError
    ? '—'
    : balance.data !== undefined
      ? `$${formatNumber(balance.data)}`
      : null;

  return { portfolio, cash };
}
