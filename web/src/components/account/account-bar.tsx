'use client';

import Image from 'next/image';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '@/components/auth/connect-button';
import { BalanceReadout } from '@/components/account/balance-readout';
import { ProfileMenu } from '@/components/account/profile-menu';
import { useAccountReadouts } from '@/lib/use-account-readouts';
import { useFaucet } from '@/lib/use-place-bet';
import { useAutoProvisionProfile } from '@/lib/use-profile';

export function AccountBar() {
  const account = useCurrentAccount();
  // First sign-in: silently registers a username from the Google email.
  useAutoProvisionProfile();
  const { portfolio, cash } = useAccountReadouts();
  const faucet = useFaucet();

  if (!account) return <ConnectButton />;

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden h-11 items-stretch gap-1 rounded-xl border border-white/5 bg-[#17191e]/95 p-1 sm:flex">
        <div className="flex items-center rounded-lg bg-[#2b2e35] px-3">
          <BalanceReadout label="Portfolio" value={portfolio} />
        </div>
        <div className="flex items-center rounded-lg bg-[#2b2e35] px-3">
          <BalanceReadout label="Cash" value={cash} />
        </div>
      </div>
      <Button
        size="sm"
        className="h-11 rounded-xl px-4"
        disabled={faucet.isPending}
        onClick={() => faucet.mutate()}
      >
        <Image
          src="/sui.jpg"
          alt="Deposit"
          width={24}
          height={24}
          className="size-6 rounded-full object-contain sm:hidden"
        />
        <span className="hidden sm:inline">{faucet.isPending ? 'Sending…' : 'Deposit'}</span>
      </Button>
      <ProfileMenu />
    </div>
  );
}
