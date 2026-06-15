'use client';

import { useQuery } from '@tanstack/react-query';
import { useBetHistory } from '@/lib/use-bet-history';
import type { BetHistoryEntry, LeaderboardEntry, StreakInfo } from '@/lib/types';

export interface LeaderboardResponse {
  weekly: LeaderboardEntry[];
  allTime: LeaderboardEntry[];
  scannedTxs: number;
  truncated: boolean;
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['leaderboard'],
    queryFn: async (): Promise<LeaderboardResponse> => {
      const res = await fetch('/api/leaderboard');
      const json = (await res.json()) as LeaderboardResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `GET /api/leaderboard → ${res.status}`);
      return json;
    },
    staleTime: 60_000, // matches the server cache
    refetchInterval: 120_000,
  });
}

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

/**
 * Consecutive UTC days with at least one bet placed, counting back from today
 * (or yesterday, so the streak isn't "broken" before you've bet today).
 */
export function computeStreakDays(bets: Pick<BetHistoryEntry, 'timestampMs'>[]): number {
  if (bets.length === 0) return 0;
  const days = new Set(bets.map((b) => utcDay(b.timestampMs)));
  const today = utcDay(Date.now());
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (cursor === null) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

export function useStreak(): { data: StreakInfo | null; isPending: boolean } {
  const history = useBetHistory();
  if (!history.data) return { data: null, isPending: history.isPending };
  return {
    data: { currentDays: computeStreakDays(history.data.bets), milestones: [3, 7, 14, 30] },
    isPending: false,
  };
}
