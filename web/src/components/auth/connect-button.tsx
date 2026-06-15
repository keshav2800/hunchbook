'use client';

import { useConnectWallet, useCurrentAccount, useWallets } from '@mysten/dapp-kit';
import { getWalletMetadata, isEnokiWallet } from '@mysten/enoki';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { NavbarButton } from '@/components/ui/resizable-navbar';

/** Signed-out Google zkLogin button. Signed-in account UI lives in ProfileMenu. */
export function ConnectButton() {
  const account = useCurrentAccount();
  const wallets = useWallets().filter(isEnokiWallet);
  const { mutate: connect, isPending } = useConnectWallet();
  if (account) return null;

  const google = wallets.find((w) => getWalletMetadata(w)?.provider === 'google');

  return (
    <NavbarButton
      as="button"
      type="button"
      variant="primary"
      className="rounded-lg bg-[#4da2ff] text-white hover:bg-[#5fb0ff] hover:translate-y-0"
      disabled={!google || isPending}
      onClick={() =>
        google &&
        connect(
          { wallet: google },
          { onError: (e) => toast.error(`Sign-in failed: ${e.message}`) },
        )
      }
    >
      <Wallet className="size-4" />
      {isPending ? 'Signing in…' : 'Sign in'}
    </NavbarButton>
  );
}
