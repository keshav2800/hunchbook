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

/** Account-manager id for `owner`, or the signed-in account when omitted. */
export function useManagerId(owner?: string) {
  const account = useCurrentAccount();
  const addr = owner ?? account?.address;
  return useQuery({
    queryKey: ['manager-id', addr],
    queryFn: () =>
      getJson<{ managerId: string | null }>(`/api/manager?owner=${addr}`).then((r) => r.managerId),
    enabled: !!addr,
    staleTime: 60_000,
  });
}

/** Positions for `owner`, or the signed-in account when omitted. */
export function usePositions(owner?: string) {
  const account = useCurrentAccount();
  const addr = owner ?? account?.address;
  const managerId = useManagerId(addr);
  return useQuery({
    queryKey: ['positions', managerId.data],
    queryFn: () =>
      getJson<PositionsResponse>(`/api/positions?manager=${managerId.data}&owner=${addr}`),
    enabled: !!managerId.data && !!addr,
    refetchInterval: 10_000,
  });
}
