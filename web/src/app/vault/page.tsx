'use client';

import { ExternalLink, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/stat-card';
import { NavChart } from '@/components/vault/nav-chart';
import { DepositWithdraw } from '@/components/vault/deposit-withdraw';
import { YieldFlywheel } from '@/components/vault/yield-flywheel';
import { LeverageProjection } from '@/components/vault/leverage-projection';
import { EXPLORER_TX } from '@/lib/bet-math';
import { formatCompactUsd, formatNumber, formatPct, formatUsd, shortAddress } from '@/lib/format';
import { useVaultStats } from '@/lib/use-vault';
import { cn } from '@/lib/utils';

const COMPOSITION_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)'];

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function VaultPage() {
  const stats = useVaultStats();

  if (stats.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        <TriangleAlert className="size-4 shrink-0" />
        Vault data unavailable: {stats.error.message}
      </div>
    );
  }

  if (!stats.data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">Liquidity Vault</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total Value Locked"
          value={formatCompactUsd(s.tvlUsd)}
          sub={s.apyPct !== null ? `APY ${formatPct(s.apyPct, false)}` : 'Targeting 8–15% APY · variable'}
          subClassName={s.apyPct !== null && s.apyPct < 0 ? 'text-negative' : 'text-positive'}
        />
        <StatCard
          label="Share Price"
          value={s.sharePrice.toFixed(4)}
          sub={s.sharePriceChangePct !== null ? `${formatPct(s.sharePriceChangePct)} / 24h` : 'vault < 24h old'}
          subClassName={
            s.sharePriceChangePct === null
              ? 'text-muted-foreground'
              : s.sharePriceChangePct >= 0
                ? 'text-positive'
                : 'text-negative'
          }
        />
        <StatCard
          label="Your Position"
          value={s.userPositionUsd !== null ? formatUsd(s.userPositionUsd) : '—'}
          sub={
            s.userShares !== null
              ? `${formatNumber(s.userShares)} PFSHARE`
              : 'Sign in to see your position'
          }
          subClassName="text-muted-foreground"
        />
      </div>

      <YieldFlywheel />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>NAV & Drawdown — on-chain history</CardTitle>
            </CardHeader>
            <CardContent>
              <NavChart history={s.history} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vault Composition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {s.composition.map((c, i) => (
                <div key={c.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{c.label}</span>
                    <span className="text-muted-foreground">{c.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${c.pct}%`,
                        background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <DepositWithdraw />
          <LeverageProjection apyPct={s.apyPct} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vault Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {s.recentTransactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No deposits or withdrawals yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>LP</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.recentTransactions.map((tx) => (
                  <TableRow key={`${tx.digest}-${tx.type}-${tx.timestampMs}`}>
                    <TableCell
                      className={cn(
                        'font-medium',
                        tx.type === 'Deposit' ? 'text-positive' : 'text-negative',
                      )}
                    >
                      {tx.type}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(tx.amountUsd)} dUSDC
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortAddress(tx.lp)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateLabel(tx.timestampMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <a
                        href={`${EXPLORER_TX}/${tx.digest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                      >
                        {tx.digest.slice(0, 6)}…
                        <ExternalLink className="size-3" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
