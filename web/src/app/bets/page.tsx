'use client';

import { TriangleAlert } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectButton } from '@/components/auth/connect-button';
import { StatsStrip } from '@/components/bets/stats-strip';
import { BetHistoryTable } from '@/components/bets/bet-history-table';
import { useBetHistory } from '@/lib/use-bet-history';

export default function MyBetsPage() {
  const account = useCurrentAccount();
  const history = useBetHistory();

  if (!account) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Sign in to see your bet history.</p>
          <ConnectButton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">My Bets</h1>
      {history.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          Couldn’t load bet history: {history.error.message}
        </div>
      ) : null}
      <StatsStrip />
      {history.data ? (
        <BetHistoryTable bets={history.data.bets} truncated={history.data.truncated} />
      ) : history.isError ? null : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}
