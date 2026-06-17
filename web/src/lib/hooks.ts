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

export interface OraclePrices {
  spots: number[];
  times: number[];
}

async function fetchOraclePrices(oracleId: string, minutes: number): Promise<OraclePrices> {
  const res = await fetch(`/api/prices?oracleId=${oracleId}&minutes=${minutes}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `GET /api/prices → ${res.status}`);
  }
  return (await res.json()) as OraclePrices;
}

/** Downsampled price history for one oracle over a chosen window (minutes). */
export const useOraclePrices = (oracleId: string | undefined, minutes: number) =>
  useQuery({
    queryKey: ['oracle-prices', oracleId, minutes],
    queryFn: () => fetchOraclePrices(oracleId!, minutes),
    enabled: !!oracleId,
    refetchInterval: 5_000,
  });
