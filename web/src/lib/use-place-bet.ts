'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { toBase64 } from '@mysten/sui/utils';
import { toast } from 'sonner';
import {
  buildCashoutTx,
  buildCreateManagerTx,
  buildPlaceBetTx,
  buildPlaceRangeBetTx,
  buildWithdrawBalanceTx,
  getDusdcBalance,
  quoteTradeAmountsRaw,
} from '@/lib/chain';
import { EXPLORER_TX } from '@/lib/bet-math';
import { showBetSuccessToast } from '@/components/trade/bet-success-toast';
import type { BetPosition, Direction, LiveMarket } from '@/lib/types';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${url} → ${res.status}`);
  return json;
}

/** Map known on-chain aborts to messages a bettor can act on. */
function friendlyTradeError(message: string): string {
  // Price moved between quote and execution (EBalanceManagerBalanceTooLow).
  if (message.includes('withdraw_with_proof') && message.includes(', 3)')) {
    return 'Price moved while placing the bet — please try again.';
  }
  // oracle_config::assert_live_oracle — market not tradeable right now.
  if (message.includes('assert_live_oracle')) {
    if (message.includes(', 3)')) return 'This market has already settled.';
    if (message.includes(', 4)'))
      return 'This market just expired and is settling — pick the next expiry.';
    if (message.includes(', 5)')) return 'This market isn’t active right now.';
    if (message.includes(', 6)'))
      return 'The price feed for this market went stale — try again in a moment.';
  }
  return message;
}

async function getManagerId(owner: string): Promise<string | null> {
  const res = await fetch(`/api/manager?owner=${owner}`);
  const json = (await res.json()) as { managerId: string | null; error?: string };
  if (!res.ok) throw new Error(json.error ?? 'manager lookup failed');
  return json.managerId;
}

export function useDusdcBalance() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['dusdc-balance', account?.address],
    queryFn: () => getDusdcBalance(client, account!.address),
    enabled: !!account,
    refetchInterval: 10_000,
  });
}

export function useFaucet() {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<{ digest: string }>('/api/faucet', { address: account!.address }),
    onSuccess: ({ digest }) => {
      toast.success('10 test dUSDC sent', {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER_TX}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
    },
    onError: (e) => toast.error(e.message),
  });
}

/** Sponsor → sign → execute one transaction built as kind-bytes. */
export function useSponsoredExecutor() {
  const client = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();

  return async (txKindBase64: string, sender: string): Promise<string> => {
    const sponsored = await postJson<{ bytes: string; digest: string }>('/api/sponsor', {
      transactionKindBytes: txKindBase64,
      sender,
    });
    const { signature } = await signTransaction({ transaction: sponsored.bytes });
    await postJson('/api/sponsor/execute', { digest: sponsored.digest, signature });
    const result = await client.waitForTransaction({
      digest: sponsored.digest,
      options: { showEffects: true },
    });
    // Finality ≠ success: surface on-chain aborts instead of toasting success.
    const status = result.effects?.status;
    if (status?.status !== 'success') {
      throw new Error(`Transaction failed on-chain: ${status?.error ?? 'unknown error'}`);
    }
    return sponsored.digest;
  };
}

type PlaceBetArgs = { market: LiveMarket; stakeUsd: number; pWin: number } & (
  | { direction: Direction; strikeUsd: number; range?: undefined }
  | { range: { lowerUsd: number; upperUsd: number }; direction?: undefined; strikeUsd?: undefined }
);

export function usePlaceBet() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (args: PlaceBetArgs) => {
      if (!account) throw new Error('Sign in first.');
      const sender = account.address;

      // 1. Ensure PredictManager exists (sponsored create on first bet)
      let managerId = await getManagerId(sender);
      if (!managerId) {
        toast.info('Setting up your account…');
        const createTx = buildCreateManagerTx();
        createTx.setSender(sender);
        const kind = await createTx.build({ client, onlyTransactionKind: true });
        await execute(toBase64(kind), sender);
        // poll the indexer for the new manager (it indexes by checkpoint)
        for (let i = 0; i < 15 && !managerId; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          managerId = await getManagerId(sender);
        }
        if (!managerId) throw new Error('Account setup not indexed yet — try again in a moment.');
      }

      // 2. Build + sponsor + sign + execute the bet
      const { market, stakeUsd } = args;
      const tx = args.range
        ? await buildPlaceRangeBetTx({
            client,
            sender,
            managerId,
            market,
            lowerUsd: args.range.lowerUsd,
            upperUsd: args.range.upperUsd,
            stakeUsd,
          })
        : await buildPlaceBetTx({
            client,
            sender,
            managerId,
            market,
            direction: args.direction,
            strikeUsd: args.strikeUsd,
            stakeUsd,
          });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      return execute(toBase64(kind), sender);
    },
    onSuccess: (_digest, args) => {
      showBetSuccessToast(
        args.range
          ? { range: args.range, stakeUsd: args.stakeUsd }
          : { direction: args.direction, strikeUsd: args.strikeUsd, stakeUsd: args.stakeUsd },
      );
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['manager-id'] });
      queryClient.invalidateQueries({ queryKey: ['bet-history'] });
    },
    onError: (e) => toast.error(friendlyTradeError(e.message)),
  });
}

const DUSDC_SCALE = 1e6;

/** Claim settled winnings or cash out an active bet at the current bid. */
export function useCashout() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (position: BetPosition) => {
      if (!account) throw new Error('Sign in first.');
      const sender = account.address;
      const managerId = await getManagerId(sender);
      if (!managerId) throw new Error('No account manager found.');

      const quantityRaw = BigInt(Math.round(position.units * DUSDC_SCALE));
      let withdrawRaw: bigint;
      if (position.status === 'settled') {
        if (!position.won) throw new Error('Nothing to claim on a lost bet.');
        withdrawRaw = quantityRaw; // settled win pays exactly $1 per unit
      } else {
        // Early cash-out: quote the protocol bid, keep 5% margin for drift.
        const { bidRaw } = await quoteTradeAmountsRaw({ client, sender, key: position, quantityRaw });
        withdrawRaw = (bidRaw * 95n) / 100n;
        if (withdrawRaw === 0n) throw new Error('Cash-out value is too small right now.');
      }

      const tx = buildCashoutTx({ sender, managerId, position, withdrawRaw });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      const digest = await execute(toBase64(kind), sender);
      return { digest, amount: Number(withdrawRaw) / DUSDC_SCALE };
    },
    onSuccess: ({ digest, amount }, position) => {
      toast.success(
        position.status === 'settled'
          ? `Winnings claimed: ${amount.toFixed(2)} dUSDC (before 1% fee)`
          : `Cashed out: ~${amount.toFixed(2)} dUSDC (before 1% fee)`,
        { action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER_TX}/${digest}`) } },
      );
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['bet-history'] });
    },
    onError: (e) => {
      const friendly =
        e.message.includes('withdraw_with_proof') && e.message.includes(', 3)')
          ? 'Price moved during cash-out — please try again.'
          : e.message;
      toast.error(friendly);
    },
  });
}

/** Withdraw the manager's internal dUSDC balance (settled winnings) to the wallet. */
export function useWithdrawBalance() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const execute = useSponsoredExecutor();

  return useMutation({
    mutationFn: async (amountUsd: number) => {
      if (!account) throw new Error('Sign in first.');
      const sender = account.address;
      const managerId = await getManagerId(sender);
      if (!managerId) throw new Error('No account manager found.');
      const amountRaw = BigInt(Math.floor(amountUsd * DUSDC_SCALE));
      if (amountRaw === 0n) throw new Error('Nothing to withdraw.');
      const tx = buildWithdrawBalanceTx({ sender, managerId, amountRaw });
      const kind = await tx.build({ client, onlyTransactionKind: true });
      const digest = await execute(toBase64(kind), sender);
      return { digest, amountUsd };
    },
    onSuccess: ({ digest, amountUsd }) => {
      toast.success(`Withdrew ${amountUsd.toFixed(2)} dUSDC to your wallet`, {
        action: { label: 'Explorer', onClick: () => window.open(`${EXPLORER_TX}/${digest}`) },
      });
      queryClient.invalidateQueries({ queryKey: ['dusdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['bet-history'] });
    },
    onError: (e) => toast.error(e.message),
  });
}
