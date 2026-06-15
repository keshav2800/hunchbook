'use client';

import { useQuery } from '@tanstack/react-query';
import type { LiveMarket } from '@/lib/types';

async function fetchLiveMarkets(): Promise<LiveMarket[]> {
  const res = await fetch('/api/markets');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `GET /api/markets → ${res.status}`);
  }
  return (await res.json()) as LiveMarket[];
}

export const useLiveMarkets = () =>
  useQuery({
    queryKey: ['live-markets'],
    queryFn: fetchLiveMarkets,
    refetchInterval: 10_000,
  });
