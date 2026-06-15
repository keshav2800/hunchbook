# Account Bar + Statistics Dialog + My Bets Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polymarket-style account bar (Portfolio / Cash / Deposit / avatar), Stake-style statistics dialog, and a `/bets` history page — all fed by the existing `/api/history` endpoint, hardened for cash-outs and cost.

**Architecture:** One shared `useBetHistory` React Query hook over `/api/history` (30 s server TTL cache). The parser gains `router::cashout` awareness so early exits show as `cashed_out` (not phantom won/lost) and post-expiry claims set real payouts. Top bar reuses existing positions/markets/balance hooks; live-value math is extracted to `lib/bet-math.ts` so the card and Portfolio can't drift.

**Tech Stack:** Next.js (app router, this repo's vendored version — see `web/AGENTS.md`), React Query, shadcn/ui, @mysten/dapp-kit. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-account-stats-mybets-design.md`

**Conventions:** Not a git repo — no commits. Single `tsc --noEmit` + lint pass at the very end (user preference: no per-task verification). dUSDC is rendered as `$` throughout the app. Theme tokens `positive`/`negative`/`warning` exist (`bg-positive`, `text-warning`, etc.).

---

### Task 1: Shared bet math (`lib/bet-math.ts`) + de-dupe call sites

**Files:**
- Create: `web/src/lib/bet-math.ts`
- Modify: `web/src/components/trade/active-bets-card.tsx` (remove local copies, import)
- Modify: `web/src/lib/use-place-bet.ts:17` (replace local `EXPLORER` const)
- Modify: `web/src/lib/format.ts` (add `shortAddress`)
- Modify: `web/src/components/auth/connect-button.tsx:22-24` (use shared `shortAddress`)

- [ ] **Step 1.1: Create `web/src/lib/bet-math.ts`**

```ts
import { binaryUpProbability } from '@/lib/svi';
import { formatUsd } from '@/lib/format';
import type { BetPosition, LiveMarket } from '@/lib/types';

export const EXPLORER_TX = 'https://suiscan.xyz/testnet/tx';

export function describeBet(p: Pick<BetPosition, 'direction' | 'strikeUsd'>): string {
  return `BTC ${p.direction === 'UP' ? '>' : '<'} ${formatUsd(p.strikeUsd, 0)}`;
}

/** Live cash-out estimate: win probability × $1-payout units. */
export function liveValue(
  p: Pick<BetPosition, 'oracleId' | 'direction' | 'strikeUsd' | 'units'>,
  markets?: LiveMarket[],
): number | null {
  const market = markets?.find((m) => m.oracleId === p.oracleId);
  if (!market?.svi) return null;
  const pUp = binaryUpProbability(market.forward, p.strikeUsd, market.svi);
  return (p.direction === 'UP' ? pUp : 1 - pUp) * p.units;
}
```

- [ ] **Step 1.2: Add `shortAddress` to `web/src/lib/format.ts`** (append)

```ts
export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
```

- [ ] **Step 1.3: In `active-bets-card.tsx`**, delete the local `describeBet` (lines 15-17) and `liveValue` (lines 19-25) functions and the now-unused `binaryUpProbability`/`formatUsd` imports; add `import { describeBet, liveValue } from '@/lib/bet-math';`. (`formatUsd` stays only if still referenced — it is, at line 129; keep it.)

- [ ] **Step 1.4: In `use-place-bet.ts`**, delete `const EXPLORER = 'https://suiscan.xyz/testnet/tx';` and add `import { EXPLORER_TX } from '@/lib/bet-math';`, renaming the four usages.

- [ ] **Step 1.5: In `connect-button.tsx`**, delete the local `shortAddress` and import it from `@/lib/format`.

### Task 2: Types for cash-out-aware history

**Files:**
- Modify: `web/src/lib/types.ts:30-48`

- [ ] **Step 2.1: Replace `BetHistoryEntry` and `BetStats`**

```ts
export interface BetHistoryEntry {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number;
  strikeUsd: number;
  direction: Direction;
  stakeUsd: number;
  units: number;
  outcome: 'won' | 'lost' | 'open' | 'cashed_out';
  settlementUsd: number | null;
  /** Actual dUSDC received for cashed_out / claimed wins; face value (units) for
   *  unclaimed wins; 0 for losses; null while open. Pre-fee for unclaimed wins. */
  payoutUsd: number | null;
}

export interface BetStats {
  totalBets: number;
  wins: number;
  losses: number;
  cashedOut: number;
  wageredUsd: number;
}
```

### Task 3: Parse cashout transactions (`parse-bets.ts`)

**Files:**
- Modify: `web/src/lib/server/parse-bets.ts` (full rewrite below)
- Modify: `web/src/app/api/positions/route.ts:27` (return shape changed → `.bets`)

`router::cashout` PTBs carry the same `market_key::up/down` move call as `place_bet`
(see `shared/src/router.ts` — `addCashoutCall`). A cashout produces a **positive** dUSDC
balance change for the owner. Claims of settled wins also go through `cashout`; they are
distinguished later by tx timestamp vs market expiry.

- [ ] **Step 3.1: Rewrite `parse-bets.ts`**

```ts
/*
 * Server-side reconstruction of a user's betting history from the chain:
 * every successful place_bet transaction carries the strike/direction/quantity
 * in its inputs and the dUSDC stake in its balance changes. router::cashout
 * txs are parsed too, so early exits and post-expiry claims can be told apart
 * from settlement outcomes.
 */
import type { SuiClient } from '@mysten/sui/client';
import { DUSDC_COIN_TYPE } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import type { Direction } from '@/lib/types';

const DUSDC_SCALE = 1e6;
const MAX_HISTORY_TXS = 200;

export interface BetTxRecord {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number; // unix ms
  strikeUsd: number;
  direction: Direction;
  stakeUsd: number;
  units: number; // $1-payout units bought
}

export interface CashoutTxRecord {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number;
  strikeUsd: number;
  direction: Direction;
  receivedUsd: number; // dUSDC that reached the wallet (after the 1% router fee)
}

export interface HistoryTxRecords {
  bets: BetTxRecord[];
  cashouts: CashoutTxRecord[];
  truncated: boolean; // MAX_HISTORY_TXS cap hit with more pages remaining
}

interface MoveCallRef {
  module: string;
  function: string;
  arguments?: unknown[];
}

export async function parseBetsFromHistory(
  client: SuiClient,
  owner: string,
): Promise<HistoryTxRecords> {
  const bets: BetTxRecord[] = [];
  const cashouts: CashoutTxRecord[] = [];
  let cursor: string | null | undefined = undefined;
  let fetched = 0;
  do {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: owner },
      options: { showInput: true, showBalanceChanges: true, showEffects: true },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const tx of page.data) {
      if (tx.effects?.status.status !== 'success') continue;
      const ptb = tx.transaction?.data.transaction;
      if (!ptb || ptb.kind !== 'ProgrammableTransaction') continue;
      const moveCalls = ptb.transactions.flatMap((c) =>
        typeof c === 'object' && c !== null && 'MoveCall' in c
          ? [(c as { MoveCall: MoveCallRef }).MoveCall]
          : [],
      );
      const keyCall = moveCalls.find((mc) => mc.module === 'market_key');
      if (!keyCall?.arguments || keyCall.arguments.length < 3) continue;

      const inputs = ptb.inputs as { value?: unknown }[];
      const inputValue = (arg: unknown): unknown => {
        const idx = (arg as { Input?: number }).Input;
        return idx !== undefined ? inputs[idx]?.value : undefined;
      };

      const oracleId = String(inputValue(keyCall.arguments[0]) ?? '');
      const expiry = Number(inputValue(keyCall.arguments[1]) ?? 0);
      const strikeRaw = Number(inputValue(keyCall.arguments[2]) ?? 0);
      if (!oracleId || !strikeRaw) continue;
      const common = {
        digest: tx.digest,
        timestampMs: Number(tx.timestampMs ?? 0),
        oracleId,
        expiry,
        strikeUsd: decodeScaled(strikeRaw),
        direction: (keyCall.function === 'up' ? 'UP' : 'DOWN') as Direction,
      };

      const ownDusdcChange = (sign: 1 | -1) =>
        tx.balanceChanges?.find(
          (b) =>
            b.coinType === DUSDC_COIN_TYPE &&
            typeof b.owner === 'object' &&
            'AddressOwner' in b.owner &&
            b.owner.AddressOwner === owner &&
            Math.sign(Number(b.amount)) === sign,
        );

      const betCall = moveCalls.find((mc) => mc.function === 'place_bet');
      const cashoutCall = moveCalls.find((mc) => mc.function === 'cashout');
      if (betCall?.arguments) {
        // place_bet args: (predict, manager, oracle, key, quantity, payment, clock)
        const quantityRaw = Number(inputValue(betCall.arguments[4]) ?? 0);
        const outflow = ownDusdcChange(-1);
        if (!outflow) continue;
        bets.push({
          ...common,
          stakeUsd: Math.abs(Number(outflow.amount)) / DUSDC_SCALE,
          units: quantityRaw / DUSDC_SCALE,
        });
      } else if (cashoutCall) {
        const inflow = ownDusdcChange(1);
        if (!inflow) continue;
        cashouts.push({ ...common, receivedUsd: Number(inflow.amount) / DUSDC_SCALE });
      }
    }
    fetched += page.data.length;
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor && fetched < MAX_HISTORY_TXS);
  return { bets, cashouts, truncated: !!cursor };
}
```

- [ ] **Step 3.2: Fix the consumer in `api/positions/route.ts`** — line 27 iterates the old
array return. Change:

```ts
  for (const r of await parseBetsFromHistory(client, owner)) {
```
to
```ts
  for (const r of (await parseBetsFromHistory(client, owner)).bets) {
```

### Task 4: History route — cashout join, stats, TTL cache (`api/history/route.ts`)

**Files:**
- Modify: `web/src/app/api/history/route.ts` (full rewrite below)

Semantics: an early cashout (tx before expiry) marks every bet on that market key
`cashed_out`, payout pro-rated by units. A post-expiry cashout is a claim — outcome stays
`won`, payout = actual received. Unclaimed wins pay face value (`units`). Cash-outs are
excluded from W/L counts, included in `wageredUsd`.

- [ ] **Step 4.1: Rewrite the route**

```ts
import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { SUI_FULLNODE_URL, listOracles } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import { parseBetsFromHistory } from '@/lib/server/parse-bets';
import type { BetHistoryEntry, BetStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface HistoryPayload {
  bets: BetHistoryEntry[];
  stats: BetStats;
  firstBetMs: number | null;
  truncated: boolean;
}

// History walks ≤200 txs per call — cache per owner for a short TTL.
// Module-level Map is fine for a single Next instance (dev/demo deployment).
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; payload: HistoryPayload }>();

const marketKey = (r: { oracleId: string; expiry: number; strikeUsd: number; direction: string }) =>
  `${r.oracleId}|${r.expiry}|${Math.round(r.strikeUsd * 100)}|${r.direction}`;

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner');
  if (!owner?.startsWith('0x')) {
    return NextResponse.json({ error: 'owner query param required' }, { status: 400 });
  }
  const hit = cache.get(owner);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  }
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    const [{ bets: records, cashouts, truncated }, oracleList] = await Promise.all([
      parseBetsFromHistory(client, owner),
      listOracles(),
    ]);
    const oracles = new Map(oracleList.map((o) => [o.oracle_id, o]));

    // Early cash-outs end a position before settlement; post-expiry cashouts are claims.
    const earlyCashouts = new Map<string, number>();
    const claims = new Map<string, number>();
    for (const c of cashouts) {
      const target = c.timestampMs < c.expiry ? earlyCashouts : claims;
      const k = marketKey(c);
      target.set(k, (target.get(k) ?? 0) + c.receivedUsd);
    }
    const unitsByKey = new Map<string, number>();
    for (const r of records) {
      const k = marketKey(r);
      unitsByKey.set(k, (unitsByKey.get(k) ?? 0) + r.units);
    }

    const bets: BetHistoryEntry[] = records.map((r) => {
      const k = marketKey(r);
      const share = (total: number) => total * (r.units / (unitsByKey.get(k) || 1));
      const early = earlyCashouts.get(k);
      if (early !== undefined) {
        return { ...r, outcome: 'cashed_out' as const, settlementUsd: null, payoutUsd: share(early) };
      }
      const oracle = oracles.get(r.oracleId);
      const settled = oracle?.status === 'settled' && oracle.settlement_price !== null;
      const settlementUsd = settled ? decodeScaled(Number(oracle!.settlement_price)) : null;
      const won = settled
        ? r.direction === 'UP'
          ? settlementUsd! > r.strikeUsd
          : settlementUsd! < r.strikeUsd
        : null;
      const claimed = claims.get(k);
      const payoutUsd = !settled ? null : won ? (claimed !== undefined ? share(claimed) : r.units) : 0;
      return {
        ...r,
        outcome: settled ? (won ? ('won' as const) : ('lost' as const)) : ('open' as const),
        settlementUsd,
        payoutUsd,
      };
    });
    bets.sort((a, b) => b.timestampMs - a.timestampMs);

    const stats: BetStats = {
      totalBets: bets.length,
      wins: bets.filter((b) => b.outcome === 'won').length,
      losses: bets.filter((b) => b.outcome === 'lost').length,
      cashedOut: bets.filter((b) => b.outcome === 'cashed_out').length,
      wageredUsd: bets.reduce((acc, b) => acc + b.stakeUsd, 0),
    };
    const firstBetMs = bets.length ? bets[bets.length - 1].timestampMs : null;

    const payload: HistoryPayload = { bets, stats, firstBetMs, truncated };
    cache.set(owner, { at: Date.now(), payload });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
```

### Task 5: `useBetHistory` hook + mutation invalidations

**Files:**
- Create: `web/src/lib/use-bet-history.ts`
- Modify: `web/src/lib/use-place-bet.ts` (`onSuccess` of `usePlaceBet`, `useCashout`, `useWithdrawBalance`)

- [ ] **Step 5.1: Create `web/src/lib/use-bet-history.ts`**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { BetHistoryEntry, BetStats } from '@/lib/types';

export interface BetHistoryResponse {
  bets: BetHistoryEntry[];
  stats: BetStats;
  firstBetMs: number | null;
  truncated: boolean;
}

export function useBetHistory() {
  const account = useCurrentAccount();
  return useQuery({
    queryKey: ['bet-history', account?.address],
    queryFn: async (): Promise<BetHistoryResponse> => {
      const res = await fetch(`/api/history?owner=${account!.address}`);
      const json = (await res.json()) as BetHistoryResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `GET /api/history → ${res.status}`);
      return json;
    },
    enabled: !!account,
    staleTime: 30_000, // matches the server-side TTL; mutations invalidate explicitly
    retry: 1,
  });
}
```

- [ ] **Step 5.2: Invalidate in `use-place-bet.ts`** — add to the `onSuccess` of
`usePlaceBet` (after line 133), `useCashout` (after line 187), and `useWithdrawBalance`
(after line 224):

```ts
      queryClient.invalidateQueries({ queryKey: ['bet-history'] });
```

(Server TTL means the refetch can be ≤30 s stale; acceptable — positions stay the live source.)

### Task 6: `AddressAvatar` + `StatCell`

**Files:**
- Create: `web/src/components/account/address-avatar.tsx`
- Create: `web/src/components/account/stat-cell.tsx`

- [ ] **Step 6.1: Create `address-avatar.tsx`**

```tsx
import { cn } from '@/lib/utils';

/** Two-hue gradient derived deterministically from the address bytes. */
function hues(address: string): [number, number] {
  let h = 0;
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return [h % 360, (h >> 9) % 360];
}

export function AddressAvatar({ address, className }: { address: string; className?: string }) {
  const [a, b] = hues(address);
  return (
    <span
      aria-hidden
      className={cn('inline-block size-8 shrink-0 rounded-full', className)}
      style={{ background: `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 45%))` }}
    />
  );
}
```

- [ ] **Step 6.2: Create `stat-cell.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

/** One labeled stat. `value === null` renders a loading skeleton. */
export function StatCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === null ? (
        <Skeleton className="mt-1 h-6 w-20" />
      ) : (
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}
```

### Task 7: `StatsDialog`

**Files:**
- Create: `web/src/components/account/stats-dialog.tsx`

- [ ] **Step 7.1: Create the dialog**

```tsx
'use client';

import { BarChart3 } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddressAvatar } from '@/components/account/address-avatar';
import { StatCell } from '@/components/account/stat-cell';
import { useBetHistory } from '@/lib/use-bet-history';
import { formatNumber, shortAddress } from '@/lib/format';

export function StatsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useCurrentAccount();
  const history = useBetHistory();
  const stats = history.data?.stats;
  const settledCount = stats ? stats.wins + stats.losses : 0;
  const winRate = stats && settledCount > 0 ? (stats.wins / settledCount) * 100 : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-4" /> Statistics
          </DialogTitle>
        </DialogHeader>

        {account ? (
          <div className="flex items-center gap-3">
            <AddressAvatar address={account.address} />
            <div>
              <p className="font-mono text-sm">{shortAddress(account.address)}</p>
              <p className="text-xs text-muted-foreground">
                {history.data
                  ? history.data.firstBetMs
                    ? `First bet on ${new Date(history.data.firstBetMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'No bets yet'
                  : '…'}
              </p>
            </div>
          </div>
        ) : null}

        {history.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <span>Couldn’t load stats: {history.error.message}</span>
            <Button variant="outline" size="sm" onClick={() => history.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {winRate !== null && stats ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Win rate</span>
                  <span className="tabular-nums">
                    {winRate.toFixed(0)}% · {stats.wins}W / {stats.losses}L
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-positive"
                    style={{ width: `${winRate}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Total Bets" value={stats ? formatNumber(stats.totalBets, 0) : null} />
              <StatCell label="Wins" value={stats ? formatNumber(stats.wins, 0) : null} />
              <StatCell label="Losses" value={stats ? formatNumber(stats.losses, 0) : null} />
              <StatCell
                label="Wagered"
                value={stats ? `${formatNumber(stats.wageredUsd)} dUSDC` : null}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### Task 8: `ProfileMenu`

**Files:**
- Create: `web/src/components/account/profile-menu.tsx`

The `StatsDialog` is a **sibling** of the `DropdownMenu` (not nested inside
`DropdownMenuContent`) so closing the menu doesn't unmount the open dialog.

- [ ] **Step 8.1: Create the menu**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';
import { BarChart3, ChevronDown, Copy, LogOut, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddressAvatar } from '@/components/account/address-avatar';
import { StatsDialog } from '@/components/account/stats-dialog';
import { shortAddress } from '@/lib/format';

export function ProfileMenu() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [statsOpen, setStatsOpen] = useState(false);
  if (!account) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-1.5" aria-label="Account menu">
            <AddressAvatar address={account.address} className="size-7" />
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-mono text-xs">
            {shortAddress(account.address)}
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(account.address);
              toast.success('Address copied');
            }}
          >
            <Copy className="size-4" /> Copy address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
```

### Task 9: `AccountBar` + top bar + slim `ConnectButton`

**Files:**
- Create: `web/src/components/account/account-bar.tsx`
- Modify: `web/src/components/app-shell/top-bar.tsx`
- Modify: `web/src/components/auth/connect-button.tsx`

Portfolio = Σ liveValue(active) + Σ units(settled wins, claimable face value) +
manager internal balance. Manager-less users (never bet) resolve to $0.00 —
`usePositions` is disabled then, so gate on `useManagerId` first.

- [ ] **Step 9.1: Create `account-bar.tsx`**

```tsx
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

function Readout({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="hidden flex-col items-end sm:flex">
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
  const markets = useLiveMarkets();
  const managerId = useManagerId();
  const positions = usePositions();
  const balance = useDusdcBalance();
  const faucet = useFaucet();

  if (!account) return <ConnectButton />;

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
    <div className="flex items-center gap-3">
      <Readout label="Portfolio" value={portfolio} />
      <Readout label="Cash" value={cash} />
      <Button size="sm" disabled={faucet.isPending} onClick={() => faucet.mutate()}>
        <Droplets className="size-4 sm:hidden" />
        <span className="hidden sm:inline">{faucet.isPending ? 'Sending…' : 'Deposit'}</span>
      </Button>
      <ProfileMenu />
    </div>
  );
}
```

- [ ] **Step 9.2: Update `top-bar.tsx`** — swap `ConnectButton` for `AccountBar`, add the
`/bets` title:

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { AccountBar } from '@/components/account/account-bar';

const TITLES: Record<string, string> = {
  '/': 'Prediction Market',
  '/bets': 'My Bets',
  '/strike': 'Strike Studio',
  '/vault': 'Liquidity Vault & LP Dashboard',
  '/leaderboard': 'Leaderboard & Gamification',
};

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <h1 className="text-sm font-medium">{TITLES[pathname] ?? 'Hunchbook'}</h1>
      <div className="ml-auto">
        <AccountBar />
      </div>
    </header>
  );
}
```

- [ ] **Step 9.3: Slim `connect-button.tsx`** to the signed-out button only (the signed-in
dropdown is superseded by `ProfileMenu`; `/bets` also reuses this for its sign-in prompt):

```tsx
'use client';

import { useConnectWallet, useCurrentAccount, useWallets } from '@mysten/dapp-kit';
import { getWalletMetadata, isEnokiWallet } from '@mysten/enoki';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ConnectButton() {
  const account = useCurrentAccount();
  const wallets = useWallets().filter(isEnokiWallet);
  const { mutate: connect, isPending } = useConnectWallet();
  if (account) return null;

  const google = wallets.find((w) => getWalletMetadata(w)?.provider === 'google');

  return (
    <Button
      size="sm"
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
      {isPending ? 'Signing in…' : 'Sign in with Google'}
    </Button>
  );
}
```

### Task 10: My Bets page (`/bets`) — strip, tabs, table, nav

**Files:**
- Create: `web/src/components/bets/stats-strip.tsx`
- Create: `web/src/components/bets/bet-history-table.tsx`
- Create: `web/src/app/bets/page.tsx`
- Modify: `web/src/components/app-shell/app-sidebar.tsx:17-22` (nav item)

- [ ] **Step 10.1: Create `stats-strip.tsx`**

```tsx
'use client';

import { StatCell } from '@/components/account/stat-cell';
import { useBetHistory } from '@/lib/use-bet-history';
import { formatNumber } from '@/lib/format';

export function StatsStrip() {
  const history = useBetHistory();
  const s = history.data?.stats;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCell label="Total Bets" value={s ? formatNumber(s.totalBets, 0) : null} />
      <StatCell label="Wins" value={s ? formatNumber(s.wins, 0) : null} />
      <StatCell label="Losses" value={s ? formatNumber(s.losses, 0) : null} />
      <StatCell label="Wagered" value={s ? `${formatNumber(s.wageredUsd)} dUSDC` : null} />
    </div>
  );
}
```

- [ ] **Step 10.2: Create `bet-history-table.tsx`**

```tsx
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
```

- [ ] **Step 10.3: Create `app/bets/page.tsx`**

```tsx
'use client';

import { TriangleAlert } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectButton } from '@/components/auth/connect-button';
import { StatsStrip } from '@/components/bets/stats-strip';
import { BetHistoryTable } from '@/components/bets/bet-history-table';
import { useBetHistory } from '@/lib/use-bet-history';

export default function MyBetsPage() {
  const account = useCurrentAccount();
  const history = useBetHistory();

  if (!account) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">Sign in to see your bet history.</p>
          <ConnectButton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {history.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          Couldn’t load bet history: {history.error.message}
        </div>
      ) : null}
      <StatsStrip />
      {history.data ? (
        <BetHistoryTable bets={history.data.bets} truncated={history.data.truncated} />
      ) : history.isError ? null : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}
```

- [ ] **Step 10.4: Add nav item in `app-sidebar.tsx`** — extend the imports and `NAV_ITEMS`:

```tsx
import { ChartCandlestick, Crosshair, History, Landmark, Trophy, Waves } from 'lucide-react';

const NAV_ITEMS = [
  { title: 'Trade', href: '/', icon: ChartCandlestick },
  { title: 'My Bets', href: '/bets', icon: History },
  { title: 'Strike Studio', href: '/strike', icon: Crosshair },
  { title: 'Vault', href: '/vault', icon: Landmark },
  { title: 'Leaderboard', href: '/leaderboard', icon: Trophy },
];
```

### Task 11: Verification (single pass, end only)

- [ ] **Step 11.1:** `cd web && npx tsc --noEmit` → expect zero errors.
- [ ] **Step 11.2:** `cd web && npx next lint` (or `npx eslint src`) → expect zero new warnings.
- [ ] **Step 11.3:** Hand off to user for browser verification: sign in → top bar shows
Portfolio/Cash/Deposit/avatar → Deposit mints dUSDC and Cash updates → avatar →
Statistics shows identity + win rate + grid → sidebar My Bets → tabs filter, payouts
colored, Tx links open Suiscan → place a bet → history invalidates and the new bet
appears as Open; cash it out → row flips to "Cashed out" with the actual amount.

## Self-review notes

- Spec coverage: all 8 production findings and all 3 surfaces have tasks (1→math, 2-4→data
  correctness/cost, 5→hook/invalidation, 6-8→dialog, 9→top bar, 10→page, 11→verify).
- Type consistency: `BetHistoryResponse` (Task 5) matches `HistoryPayload` (Task 4);
  `payoutUsd`/`cashedOut` (Task 2) produced in Task 4, consumed in Tasks 7/10;
  `parseBetsFromHistory` return change (Task 3) has its only other consumer fixed in 3.2.
- Cashed-out rows appear only under All (tab values match outcomes; `cashed_out` has no tab) —
  per spec.
