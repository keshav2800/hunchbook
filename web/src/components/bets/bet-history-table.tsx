'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { describeBet, EXPLORER_TX } from '@/lib/bet-math';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BetHistoryEntry } from '@/lib/types';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

const EMPTY_COPY: Record<TabValue, string> = {
  all: 'No bets yet — place your first one on the Trade page.',
  open: 'No open bets.',
  won: 'No wins yet.',
  lost: 'No losses — nice.',
};

const OUTCOME_BADGE: Record<BetHistoryEntry['outcome'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'border border-border bg-transparent text-foreground' },
  won: { label: 'Won', className: 'bg-positive/15 text-positive' },
  lost: { label: 'Lost', className: 'bg-muted text-muted-foreground' },
  cashed_out: { label: 'Cashed out', className: 'bg-secondary text-secondary-foreground' },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function PayoutCell({ b }: { b: BetHistoryEntry }) {
  if (b.payoutUsd === null) return <span className="text-muted-foreground">—</span>;
  if (b.payoutUsd === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={b.outcome === 'won' ? 'text-positive' : 'text-foreground'}>
      +{formatNumber(b.payoutUsd)}
    </span>
  );
}

export function BetHistoryTable({
  bets,
  truncated,
}: {
  bets: BetHistoryEntry[];
  truncated: boolean;
}) {
  const [tab, setTab] = useState<TabValue>('all');
  const rows = bets.filter((b) => (tab === 'all' ? true : b.outcome === tab));

  return (
    <Card>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{EMPTY_COPY[tab]}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bet</TableHead>
                <TableHead className="text-right">Stake</TableHead>
                <TableHead className="text-right">Payout</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const badge = OUTCOME_BADGE[b.outcome];
                return (
                  <TableRow key={b.digest}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(b.timestampMs)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-medium">
                        {b.direction === 'UP' ? (
                          <ArrowUp className="size-3.5 shrink-0 text-positive" />
                        ) : (
                          <ArrowDown className="size-3.5 shrink-0 text-negative" />
                        )}
                        {describeBet(b)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(b.stakeUsd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <PayoutCell b={b} />
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('font-normal', badge.className)}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`${EXPLORER_TX}/${b.digest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                      >
                        {b.digest.slice(0, 6)}…
                        <ExternalLink className="size-3" />
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {truncated ? (
          <p className="text-center text-xs text-muted-foreground">
            Showing bets from your last 200 transactions.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
