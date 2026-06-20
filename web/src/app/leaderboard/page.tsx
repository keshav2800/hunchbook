'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Flame, Search, TriangleAlert } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddressAvatar } from '@/components/account/address-avatar';
import { Podium, type LeaderMetric } from '@/components/leaderboard/podium';
import { useLeaderboard } from '@/lib/use-leaderboard';
import { useUsernames } from '@/lib/use-profile';
import { formatPct, formatUsd, profilePath, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeaderboardEntry, LeaderboardPeriod } from '@/lib/types';

export default function LeaderboardPage() {
  const account = useCurrentAccount();
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');
  const [metric, setMetric] = useState<LeaderMetric>('pnl');
  const [query, setQuery] = useState('');
  const leaderboard = useLeaderboard();

  const entries = period === 'weekly' ? leaderboard.data?.weekly : leaderboard.data?.allTime;
  const usernames = useUsernames(entries?.map((e) => e.address) ?? []);
  const nameMap = usernames.data ?? {};

  // Re-rank client-side by the active metric so the podium + list stay in sync
  // with the Profit/Loss ↔ Volume toggle.
  const ranked = useMemo(() => {
    if (!entries) return [];
    const key = metric === 'pnl' ? (e: LeaderboardEntry) => e.pnlUsd : (e: LeaderboardEntry) => e.wageredUsd;
    return [...entries]
      .sort((a, b) => key(b) - key(a))
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [entries, metric]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ranked.filter(
        (e) => (nameMap[e.address] ?? '').toLowerCase().includes(q) || e.address.toLowerCase().includes(q),
      )
    : ranked;
  const searching = q.length > 0;

  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold uppercase tracking-wide">Global Leaderboard</h1>
          <p className="text-xs text-muted-foreground">Sui Testnet</p>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
          <TabsList>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="all-time">All-Time</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {leaderboard.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          Leaderboard unavailable: {leaderboard.error.message}
        </div>
      ) : !entries ? (
        <div className="space-y-4">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No bets {period === 'weekly' ? 'this week' : 'yet'} — be the first on the board.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Podium hides while searching so results read as one flat list */}
          <AnimatePresence initial={false}>
            {!searching ? (
              <motion.div
                key="podium"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Podium top3={top3} usernames={nameMap} you={account?.address} metric={metric} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Search + sortable Profit/Loss | Volume table */}
          <div className="px-1">
            <div className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 border-b border-white/10 pb-3 sm:grid-cols-[1.5rem_1fr_8rem_8rem]">
              <div className="col-span-2 flex items-center gap-2 text-muted-foreground">
                <Search className="size-4 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <SortHeader label="Profit/Loss" active={metric === 'pnl'} onClick={() => setMetric('pnl')} />
              <SortHeader
                label="Volume"
                active={metric === 'volume'}
                onClick={() => setMetric('volume')}
                className="hidden sm:flex sm:border-l sm:border-white/15"
              />
            </div>

            <div className="divide-y divide-white/[0.06]">
              <AnimatePresence initial={false} mode="popLayout">
                {filtered.map((entry, i) => (
                  <LeaderRow
                    key={entry.address}
                    entry={entry}
                    name={nameMap[entry.address]}
                    isYou={account?.address === entry.address}
                    metric={metric}
                    index={i}
                  />
                ))}
              </AnimatePresence>
            </div>

            {searching && filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No bettors match “{query}”.</p>
            ) : null}
            {!searching && rest.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Only the podium so far — climb on with your next bet.
              </p>
            ) : null}
          </div>

          {leaderboard.data?.truncated ? (
            <p className="text-center text-xs text-muted-foreground">
              Based on the most recent {leaderboard.data.scannedTxs} betting transactions.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-end whitespace-nowrap text-sm font-medium transition-colors sm:w-32',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {label}
      {active ? (
        <motion.span
          layoutId="leader-sort-underline"
          className="absolute -bottom-3 right-0 h-0.5 w-10 rounded-full bg-primary"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      ) : null}
    </button>
  );
}

function LeaderRow({
  entry,
  name,
  isYou,
  metric,
  index,
}: {
  entry: LeaderboardEntry;
  name?: string;
  isYou: boolean;
  metric: LeaderMetric;
  index: number;
}) {
  const settled = entry.wins + entry.losses > 0;
  const pnlUp = entry.pnlUsd >= 0;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.25), ease: 'easeOut' }}
    >
      <Link
        href={profilePath(entry.address)}
        className={cn(
          'grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 rounded-lg px-1 py-3.5 transition-colors hover:bg-white/[0.03] sm:grid-cols-[1.5rem_1fr_8rem_8rem]',
          isYou && 'bg-primary/[0.07]',
        )}
      >
        <span className="text-center font-mono text-sm text-muted-foreground tabular-nums">{entry.rank}</span>

        <div className="flex min-w-0 items-center gap-3">
          <AddressAvatar address={entry.address} className="size-9 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold text-foreground">
                {name ?? shortAddress(entry.address)}
              </span>
              {isYou ? (
                <span className="rounded bg-primary/20 px-1 text-[9px] font-semibold uppercase tracking-wide text-primary">
                  You
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
              {settled ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-warning">
                  <Flame className="size-3 fill-current" />
                  {formatPct(entry.winRatePct, false)}
                </span>
              ) : null}
              <span>
                {entry.wins}W / {entry.losses}L
              </span>
            </div>
          </div>
        </div>

        {/* Profit/Loss */}
        <div
          className={cn(
            'text-right font-mono text-[15px] font-semibold tabular-nums sm:w-32',
            metric === 'pnl' ? (pnlUp ? 'text-positive' : 'text-negative') : 'text-muted-foreground',
          )}
        >
          {pnlUp ? '+' : '-'}
          {formatUsd(Math.abs(entry.pnlUsd))}
        </div>

        {/* Volume (hidden on the narrowest screens, like the reference's two columns) */}
        <div
          className={cn(
            'hidden text-right font-mono text-[15px] tabular-nums sm:block sm:w-32',
            metric === 'volume' ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {formatUsd(entry.wageredUsd)}
        </div>
      </Link>
    </motion.div>
  );
}
