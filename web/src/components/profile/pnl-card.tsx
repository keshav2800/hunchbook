'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Share2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PnlChart } from '@/components/profile/pnl-chart';
import { useBetHistory } from '@/lib/use-bet-history';
import { formatUsd, profilePath } from '@/lib/format';
import { shareLink } from '@/lib/share';
import { cn } from '@/lib/utils';
import { PNL_WINDOWS, type PnlWindow, pnlSeries, windowLabel } from '@/lib/pnl';

export function PnlCard({ address }: { address: string }) {
  const history = useBetHistory(address);
  const [range, setRange] = useState<PnlWindow>('1D');

  const series = useMemo(
    () => (history.data ? pnlSeries(history.data.bets, range, Date.now()) : null),
    [history.data, range],
  );

  const total = series?.total ?? 0;
  const positive = total >= 0;
  const signed = `${total > 0 ? '+' : total < 0 ? '−' : ''}${formatUsd(Math.abs(total))}`;

  const share = () => shareLink(window.location.origin + profilePath(address));

  return (
    <Card className="flex h-full flex-col justify-between gap-0">
      <div className="flex items-start justify-between px-(--card-spacing)">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground/60" />
          Profit/Loss
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {PNL_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setRange(w)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                w === range
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="relative px-(--card-spacing) pt-3">
        {/* Brand watermark, mirroring the reference's top-right mark. */}
        <Image
          src="/hunchbook.png"
          alt=""
          aria-hidden
          width={88}
          height={88}
          className="pointer-events-none absolute right-(--card-spacing) top-2 size-12 opacity-15 grayscale"
        />
        {history.isPending ? (
          <Skeleton className="h-10 w-32" />
        ) : (
          <p
            className={cn(
              'flex items-center gap-2 text-3xl font-bold tabular-nums',
              total > 0 ? 'text-positive' : total < 0 ? 'text-negative' : 'text-foreground',
            )}
          >
            {signed}
            <button
              type="button"
              onClick={share}
              aria-label="Share P/L"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Share2 className="size-4" />
            </button>
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{windowLabel(range)}</p>
      </div>

      <div className="mt-3 h-36 w-full px-1">
        {history.isPending || !series ? (
          <div className="flex h-full items-end px-(--card-spacing) pb-2">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <PnlChart series={series} positive={positive} />
        )}
      </div>
    </Card>
  );
}
