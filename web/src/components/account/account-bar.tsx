'use client';

import { Droplets } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectButton } from '@/components/auth/connect-button';
import { ProfileMenu } from '@/components/account/profile-menu';
import { liveValue } from '@/lib/bet-math';
import { formatNumber } from '@/lib/format';
import { useLiveMarkets } from '@/lib/hooks';
import { useDusdcBalance, useFaucet } from '@/lib/use-place-bet';
import { useManagerId, usePositions } from '@/lib/use-positions';
import { useAutoProvisionProfile } from '@/lib/use-profile';

function Readout({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
      {value === null ? (
        <Skeleton className="h-4 w-14" />
      ) : (
        <span className="text-sm font-semibold leading-tight tabular-nums text-positive">
          {value}
        </span>
      )}
    </div>
  );
}

export function AccountBar() {
  const account = useCurrentAccount();
  // First sign-in: silently registers a username from the Google email.
  useAutoProvisionProfile();
  const markets = useLiveMarkets();
  const managerId = useManagerId();
  const positions = usePositions();
  const balance = useDusdcBalance();
  const faucet = useFaucet();

  if (!account) return <ConnectButton />;

  // Portfolio = live value of active bets + claimable wins (face value) + manager balance.
  let portfolio: string | null = null;
  if (managerId.isError || positions.isError) portfolio = '—';
  else if (managerId.data === null) portfolio = `$${formatNumber(0)}`;
  else if (positions.data) {
    const value = positions.data.positions.reduce((acc, p) => {
      if (p.status === 'active') return acc + (liveValue(p, markets.data) ?? 0);
      return p.won ? acc + p.units : acc;
    }, positions.data.managerBalanceUsd);
    portfolio = `$${formatNumber(value)}`;
  }

  const cash = balance.isError
    ? '—'
    : balance.data !== undefined
      ? `$${formatNumber(balance.data)}`
      : null;

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden h-11 items-stretch gap-1 rounded-xl border border-white/5 bg-[#17191e]/95 p-1 sm:flex">
        <div className="flex items-center rounded-lg bg-[#2b2e35] px-3">
          <Readout label="Portfolio" value={portfolio} />
        </div>
        <div className="flex items-center rounded-lg bg-[#2b2e35] px-3">
          <Readout label="Cash" value={cash} />
        </div>
      </div>
      <Button
        size="sm"
        className="h-11 rounded-xl px-4"
        disabled={faucet.isPending}
        onClick={() => faucet.mutate()}
      >
        <Droplets className="size-4 sm:hidden" />
        <span className="hidden sm:inline">{faucet.isPending ? 'Sending…' : 'Deposit'}</span>
      </Button>
      <ProfileMenu />
    </div>
  );
}
