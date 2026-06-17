'use client';

import { StatCell } from '@/components/account/stat-cell';
import { useBetHistory } from '@/lib/use-bet-history';
import { formatNumber } from '@/lib/format';

export function StatsStrip({ address }: { address?: string } = {}) {
  const history = useBetHistory(address);
  const s = history.data?.stats;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCell label="Total Bets" value={s ? formatNumber(s.totalBets, 0) : null} />
      <StatCell label="Wins" value={s ? formatNumber(s.wins, 0) : null} />
      <StatCell label="Losses" value={s ? formatNumber(s.losses, 0) : null} />
      <StatCell label="Wagered" value={s ? `${formatNumber(s.wageredUsd)} dUSDC` : null} />
    </div>
  );
}
