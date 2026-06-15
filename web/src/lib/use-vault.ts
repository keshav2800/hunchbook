'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { toBase64 } from '@mysten/sui/utils';
import { toast } from 'sonner';
import { buildVaultDepositTx, buildVaultWithdrawTx } from '@/lib/chain';
import { EXPLORER_TX } from '@/lib/bet-math';
import { useSponsoredExecutor } from '@/lib/use-place-bet';
import type { VaultStats } from '@/lib/types';

/** Map vault abort codes (vault.move error consts) to LP-readable messages. */
function friendlyVaultError(message: string): string {
  if (!message.includes('MoveAbort')) return message;
  if (message.includes(', 2)')) return 'The vault is paused right now — try again later.';
  if (message.includes(', 4)')) return 'The vault is at capacity and not accepting deposits.';
  if (message.includes(', 6)'))
    return 'Vault liquidity is deployed to the pool right now — try a smaller amount or try again soon.';
  if (message.includes(', 7)')) return 'Not enough vault shares for that amount.';
  return message;
}

export function useVaultStats() {
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['vault', account?.address ?? 'anon'],
    queryFn: async (): Promise<VaultStats> => {
      const url = account ? `/api/vault?owner=${account.address}` : '/api/vault';
      const res = await fetch(url);
      const json = (await res.json()) as VaultStats & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `GET /api/vault → ${res.status}`);
      return json;
    },
    refetchInterval: 15_000,
  });
}

export function useVaultDeposit() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (amountUsd: number) => {
      if (!account) throw new Error('Sign in first.');
      const tx = await buildVaultDepositTx({ client, sender: account.address, amountUsd });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      const digest = await execute(toBase64(kind), account.address);
      return { digest, amountUsd };
    },
    onSuccess: ({ digest, amountUsd }) => {
      toast.success(`Deposited ${amountUsd} dUSDC into the vault`, {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER_TX}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['vault'] });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
    },
    onError: (e) => toast.error(friendlyVaultError(e.message)),
  });
}

export function useVaultWithdraw() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (args: { sharesRaw: bigint; estUsd: number }) => {
      if (!account) throw new Error('Sign in first.');
      const tx = await buildVaultWithdrawTx({
        client,
        sender: account.address,
        sharesRaw: args.sharesRaw,
      });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      const digest = await execute(toBase64(kind), account.address);
      return { digest, estUsd: args.estUsd };
    },
    onSuccess: ({ digest, estUsd }) => {
      toast.success(`Withdrew ~${estUsd.toFixed(2)} dUSDC from the vault`, {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER_TX}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['vault'] });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
    },
    onError: (e) => toast.error(friendlyVaultError(e.message)),
  });
}
