'use client';

import { BarChart3 } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddressAvatar } from '@/components/account/address-avatar';
import { StatCell } from '@/components/account/stat-cell';
import { useBetHistory } from '@/lib/use-bet-history';
import { useUsernames } from '@/lib/use-profile';
import { formatNumber, shortAddress } from '@/lib/format';

export function StatsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useCurrentAccount();
  const history = useBetHistory();
  const usernames = useUsernames(account ? [account.address] : []);
  const username = account ? usernames.data?.[account.address] : undefined;
  const stats = history.data?.stats;
  const settledCount = stats ? stats.wins + stats.losses : 0;
  const winRate = stats && settledCount > 0 ? (stats.wins / settledCount) * 100 : null;
  // Make the grid reconcile: cashed-out and open bets count toward Total but not W/L.
  const openCount = stats ? stats.totalBets - stats.wins - stats.losses - stats.cashedOut : 0;
  const breakdown = stats
    ? [
        stats.cashedOut > 0 ? `${stats.cashedOut} cashed out (not a win or loss)` : null,
        openCount > 0 ? `${openCount} open` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-4" /> Statistics
          </DialogTitle>
        </DialogHeader>

        {account ? (
          <div className="flex items-center gap-3">
            <AddressAvatar address={account.address} />
            <div>
              {username ? (
                <p className="text-sm font-semibold">{username}</p>
              ) : null}
              <p className="font-mono text-sm">{shortAddress(account.address)}</p>
              <p className="text-xs text-muted-foreground">
                {history.data
                  ? history.data.firstBetMs
                    ? `First bet on ${new Date(history.data.firstBetMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'No bets yet'
                  : '…'}
              </p>
            </div>
          </div>
        ) : null}

        {history.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <span>Couldn’t load stats: {history.error.message}</span>
            <Button variant="outline" size="sm" onClick={() => history.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {winRate !== null && stats ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Win rate</span>
                  <span className="tabular-nums">
                    {winRate.toFixed(0)}% · {stats.wins}W / {stats.losses}L
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-positive"
                    style={{ width: `${winRate}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Total Bets" value={stats ? formatNumber(stats.totalBets, 0) : null} />
              <StatCell label="Wins" value={stats ? formatNumber(stats.wins, 0) : null} />
              <StatCell label="Losses" value={stats ? formatNumber(stats.losses, 0) : null} />
              <StatCell
                label="Wagered"
                value={stats ? `${formatNumber(stats.wageredUsd)} dUSDC` : null}
              />
            </div>
            {breakdown ? (
              <p className="text-center text-xs text-muted-foreground">{breakdown}</p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
