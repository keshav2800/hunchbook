'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddressAvatar } from '@/components/account/address-avatar';
import { StreakCounter } from '@/components/leaderboard/streak-counter';
import { useLeaderboard, useStreak } from '@/lib/use-leaderboard';
import { useUsernames } from '@/lib/use-profile';
import { formatNumber, formatPct, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeaderboardPeriod } from '@/lib/types';

const MEDAL_COLORS = ['text-warning', 'text-muted-foreground', 'text-accent-foreground'];

export default function LeaderboardPage() {
  const account = useCurrentAccount();
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');
  const leaderboard = useLeaderboard();
  const streak = useStreak();

  const entries =
    period === 'weekly' ? leaderboard.data?.weekly : leaderboard.data?.allTime;
  const usernames = useUsernames(entries?.map((e) => e.address) ?? []);

  return (
    <div className="space-y-6">
      {account ? (
        streak.data ? (
          <StreakCounter streak={streak.data} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Global Leaderboard — Sui Testnet</CardTitle>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
            <TabsList>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="all-time">All-Time</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-3">
          {leaderboard.isError ? (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <TriangleAlert className="size-4 shrink-0" />
              Leaderboard unavailable: {leaderboard.error.message}
            </div>
          ) : !entries ? (
            <Skeleton className="h-96 w-full" />
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No bets {period === 'weekly' ? 'this week' : 'yet'} — be the first on the board.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Bettor</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Record</TableHead>
                  <TableHead className="text-right">Wagered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isYou = account?.address === entry.address;
                  const name = usernames.data?.[entry.address];
                  return (
                    <TableRow key={entry.address} className={cn(isYou && 'bg-accent/10')}>
                      <TableCell
                        className={cn(
                          'font-semibold',
                          entry.rank <= 3 && MEDAL_COLORS[entry.rank - 1],
                        )}
                      >
                        #{entry.rank}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <AddressAvatar address={entry.address} className="size-6" />
                          {name ? (
                            <span className="font-medium">{name}</span>
                          ) : (
                            <span className="font-mono text-sm">{shortAddress(entry.address)}</span>
                          )}
                          {isYou ? <Badge className="bg-accent text-accent-foreground">You</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.wins + entry.losses > 0 ? formatPct(entry.winRatePct, false) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {entry.wins}W / {entry.losses}L
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(entry.wageredUsd)} dUSDC
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {leaderboard.data?.truncated ? (
            <p className="text-center text-xs text-muted-foreground">
              Based on the most recent {leaderboard.data.scannedTxs} betting transactions.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
