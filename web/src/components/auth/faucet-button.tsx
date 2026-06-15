'use client';

import { useCurrentAccount } from '@mysten/dapp-kit';
import { Droplets } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDusdcBalance, useFaucet } from '@/lib/use-place-bet';

/** Shows "Get test dUSDC" when the signed-in user's balance is zero. */
export function FaucetButton() {
  const account = useCurrentAccount();
  const balance = useDusdcBalance();
  const faucet = useFaucet();

  if (!account || balance.data === undefined || balance.data > 0) return null;

  return (
    <Button variant="outline" size="sm" disabled={faucet.isPending} onClick={() => faucet.mutate()}>
      <Droplets className="size-4" />
      {faucet.isPending ? 'Sending…' : 'Get test dUSDC'}
    </Button>
  );
}
