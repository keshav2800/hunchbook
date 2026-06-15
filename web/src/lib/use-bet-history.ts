'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { BetHistoryEntry, BetStats } from '@/lib/types';

export interface BetHistoryResponse {
  bets: BetHistoryEntry[];
  stats: BetStats;
  firstBetMs: number | null;
  truncated: boolean;
}

export function useBetHistory() {
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['bet-history', account?.address],
    queryFn: async (): Promise<BetHistoryResponse> => {
      const res = await fetch(`/api/history?owner=${account!.address}`);
      const json = (await res.json()) as BetHistoryResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `GET /api/history → ${res.status}`);
      return json;
    },
    enabled: !!account,
    staleTime: 30_000, // matches the server-side TTL; mutations invalidate explicitly
    retry: 1,
  });
}
