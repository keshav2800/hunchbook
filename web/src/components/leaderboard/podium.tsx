'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { formatCompactUsd, formatPct, profilePath, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/types';

export type LeaderMetric = 'pnl' | 'volume';
type Rank = 1 | 2 | 3;
type Spot = { rank: Rank; entry?: LeaderboardEntry; name?: string };

const RANK_LABEL: Record<Rank, string> = { 1: '1st', 2: '2nd', 3: '3rd' };
// Winner is tallest/centered; blue is its accent. Others recede in dark.
const META: Record<Rank, { minH: string; delay: number }> = {
  1: { minH: 'min-h-[16rem]', delay: 0.12 },
  2: { minH: 'min-h-[13.25rem]', delay: 0.04 },
  3: { minH: 'min-h-[12.5rem]', delay: 0.08 },
};

/** Big headline value for the active sort (signed + tinted for P/L). */
function headline(e: LeaderboardEntry, metric: LeaderMetric): { text: string; cls: string; caption: string } {
  if (metric === 'volume') return { text: formatCompactUsd(e.wageredUsd), cls: 'text-foreground', caption: 'Volume' };
  const up = e.pnlUsd >= 0;
  return {
    text: `${up ? '+' : '-'}${formatCompactUsd(Math.abs(e.pnlUsd))}`,
    cls: up ? 'text-positive' : 'text-negative',
    caption: 'Profit/Loss',
  };
}

function RankChip({ rank, winner }: { rank: Rank; winner: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider',
        winner
          ? 'bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]'
          : 'border border-white/10 bg-[#17191e] text-muted-foreground',
      )}
    >
      {RANK_LABEL[rank]}
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function PodiumCard({ spot, you, metric }: { spot: Spot; you: boolean; metric: LeaderMetric }) {
  const m = META[spot.rank];
  const e = spot.entry;
  const isWinner = spot.rank === 1;

  if (!e) {
    return (
      <div className={cn('flex flex-col rounded-xl border border-dashed border-white/10 bg-[#0d0f14]/60 p-4', m.minH)}>
        <RankChip rank={spot.rank} winner={false} />
        <p className="m-auto text-xs text-muted-foreground">Open spot</p>
      </div>
    );
  }

  const settled = e.wins + e.losses > 0;
  const h = headline(e, metric);
  const tag = spot.name ?? shortAddress(e.address);

  return (
    <Link href={profilePath(e.address)} className="group block">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 130, damping: 17, delay: m.delay }}
        style={isWinner ? { boxShadow: '0 0 48px -16px rgba(77,162,255,0.55)' } : undefined}
        className={cn(
          'relative flex flex-col overflow-hidden rounded-xl border bg-[#0d0f14] p-4 transition-transform duration-200 group-hover:-translate-y-1',
          m.minH,
          isWinner ? 'border-primary/40' : 'border-white/10',
        )}
      >
        {/* faint blue wash for the winner — accent, not surface */}
        {isWinner ? (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 size-44 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}

        <div className="relative flex items-center justify-between">
          <RankChip rank={spot.rank} winner={isWinner} />
          {you ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              You
            </span>
          ) : null}
        </div>

        <div className="relative mt-3 truncate text-base font-semibold text-foreground">{tag}</div>

        <div className="relative mt-2">
          <div className={cn('font-mono font-bold tabular-nums', isWinner ? 'text-3xl' : 'text-2xl', h.cls)}>
            {h.text}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{h.caption}</div>
        </div>

        <div className="relative mt-auto space-y-2 border-t border-white/10 pt-3 text-xs">
          <StatRow label="Accuracy" value={settled ? formatPct(e.winRatePct, false) : 'New'} />
          <StatRow label="Predictions" value={String(e.totalBets)} />
        </div>
      </motion.div>
    </Link>
  );
}

/** Top-3 podium in the 2 / 1 / 3 stage order, in the Quick-Bet visual language. */
export function Podium({
  top3,
  usernames,
  you,
  metric,
}: {
  top3: LeaderboardEntry[];
  usernames: Record<string, string | undefined>;
  you?: string;
  metric: LeaderMetric;
}) {
  const spots: Spot[] = ([2, 1, 3] as Rank[]).map((r) => {
    const entry = top3.find((e) => e.rank === r);
    return { rank: r, entry, name: entry ? usernames[entry.address] : undefined };
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
        {spots.map((s) => (
          <PodiumCard key={s.rank} spot={s} you={!!you && s.entry?.address === you} metric={metric} />
        ))}
      </div>
      <p className="text-center text-[11px] uppercase tracking-wider text-muted-foreground">
        {metric === 'pnl' ? 'Ranked by profit & loss' : 'Ranked by volume wagered'}
      </p>
    </div>
  );
}
