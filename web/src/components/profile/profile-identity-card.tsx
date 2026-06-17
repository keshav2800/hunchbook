'use client';

import { Copy, Pencil, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressAvatar } from '@/components/account/address-avatar';
import { positionsMarketValueUsd } from '@/lib/bet-math';
import { biggestWinUsd } from '@/lib/pnl';
import { formatNumber, formatUsd, profilePath, shortAddress } from '@/lib/format';
import { useLiveMarkets } from '@/lib/hooks';
import { useBetHistory } from '@/lib/use-bet-history';
import { usePositions } from '@/lib/use-positions';
import { shareLink } from '@/lib/share';
import { useFaucet, useWithdrawBalance } from '@/lib/use-place-bet';

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      {value === null ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const joinedLabel = (ms: number) =>
  `Joined ${new Date(ms).toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;

export function ProfileIdentityCard({
  address,
  owner,
  username,
  views,
  createdAt,
  metaPending,
  onEdit,
}: {
  address: string;
  /** Owner view: shows edit pencil + Deposit/Withdraw. */
  owner: boolean;
  username?: string;
  views?: number;
  createdAt?: number;
  /** Profile-meta query still loading — distinguishes "loading" from "no profile". */
  metaPending?: boolean;
  onEdit?: () => void;
}) {
  const history = useBetHistory(address);
  const positions = usePositions(address);
  const markets = useLiveMarkets();
  const faucet = useFaucet();
  const withdraw = useWithdrawBalance();

  const cash = positions.data?.managerBalanceUsd ?? 0;
  const positionsValue = positions.data
    ? positionsMarketValueUsd(positions.data.positions, markets.data)
    : null;
  const biggestWin = history.data ? biggestWinUsd(history.data.bets) : null;
  const predictions = history.data?.stats.totalBets ?? null;

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied');
  };
  const share = () => shareLink(window.location.origin + profilePath(address));

  return (
    <Card className="flex h-full flex-col justify-between">
      <div className="flex items-start gap-4 px-(--card-spacing)">
        <AddressAvatar address={address} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="truncate font-mono text-lg font-semibold">
              {username || shortAddress(address)}
            </p>
            <IconButton label="Copy address" onClick={copyAddress}>
              <Copy className="size-4" />
            </IconButton>
            {owner && onEdit ? (
              <IconButton label="Edit profile" onClick={onEdit}>
                <Pencil className="size-4" />
              </IconButton>
            ) : null}
            <IconButton label="Share profile" onClick={share}>
              <Share2 className="size-4" />
            </IconButton>
          </div>
          {createdAt ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {joinedLabel(createdAt)} · {formatNumber(views ?? 0, 0)} views
            </p>
          ) : metaPending ? (
            <Skeleton className="mt-1 h-4 w-40" />
          ) : (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{shortAddress(address)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 px-(--card-spacing) pt-5">
        <Stat
          label="Positions Value"
          value={positionsValue === null ? null : formatUsd(positionsValue)}
        />
        <Stat label="Biggest Win" value={biggestWin === null ? null : formatUsd(biggestWin)} />
        <Stat label="Predictions" value={predictions === null ? null : formatNumber(predictions, 0)} />
      </div>

      {owner ? (
        <div className="grid grid-cols-2 gap-3 px-(--card-spacing) pt-5">
          <Button disabled={faucet.isPending} onClick={() => faucet.mutate()}>
            {faucet.isPending ? 'Depositing…' : 'Deposit'}
          </Button>
          <Button
            variant="secondary"
            disabled={withdraw.isPending || cash <= 0}
            onClick={() => withdraw.mutate(cash)}
          >
            {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
