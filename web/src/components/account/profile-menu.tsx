'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';
import { BarChart3, Copy, LogOut, Menu, Trophy, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BalanceReadout } from '@/components/account/balance-readout';
import { StatsDialog } from '@/components/account/stats-dialog';
import { shortAddress } from '@/lib/format';
import { useAccountReadouts } from '@/lib/use-account-readouts';

export function ProfileMenu() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const { portfolio, cash } = useAccountReadouts();
  const [statsOpen, setStatsOpen] = useState(false);
  if (!account) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* DeepBook-style boxed hamburger trigger */}
          <button
            type="button"
            aria-label="Account menu"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-[#17191e]/95 text-foreground transition-colors hover:bg-[#2b2e35]"
          >
            <Menu className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-mono text-xs">
            {shortAddress(account.address)}
          </DropdownMenuLabel>
          {/* Portfolio/Cash live in the top nav on ≥sm; surface them here on mobile. */}
          <div className="grid grid-cols-2 gap-1 p-1 sm:hidden">
            <div className="flex items-center justify-center rounded-lg bg-[#2b2e35] py-1.5">
              <BalanceReadout label="Portfolio" value={portfolio} />
            </div>
            <div className="flex items-center justify-center rounded-lg bg-[#2b2e35] py-1.5">
              <BalanceReadout label="Cash" value={cash} />
            </div>
          </div>
          <DropdownMenuSeparator className="sm:hidden" />
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(account.address);
              toast.success('Address copied');
            }}
          >
            <Copy className="size-4" /> Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserRound className="size-4" /> Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setStatsOpen(true)}>
            <BarChart3 className="size-4" /> Statistics
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/leaderboard">
              <Trophy className="size-4" /> Leaderboard
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => disconnect()}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StatsDialog open={statsOpen} onOpenChange={setStatsOpen} />
    </>
  );
}
