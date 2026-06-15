'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { BetPosition } from '@/lib/types';

export interface PositionsResponse {
  positions: BetPosition[];
  managerBalanceUsd: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${url} → ${res.status}`);
  return json;
}

export function useManagerId() {
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['manager-id', account?.address],
    queryFn: () =>
      getJson<{ managerId: string | null }>(`/api/manager?owner=${account!.address}`).then(
        (r) => r.managerId,
      ),
    enabled: !!account,
    staleTime: 60_000,
  });
}

export function usePositions() {
  const account = useCurrentAccount();
  const managerId = useManagerId();
  return useQuery({
    queryKey: ['positions', managerId.data],
    queryFn: () =>
      getJson<PositionsResponse>(`/api/positions?manager=${managerId.data}&owner=${account!.address}`),
    enabled: !!managerId.data && !!account,
    refetchInterval: 10_000,
  });
}
