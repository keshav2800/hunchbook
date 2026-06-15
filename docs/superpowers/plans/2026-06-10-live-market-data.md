# Live DeepBook Predict Market Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web app's mock market data with real DeepBook Predict testnet reads (4 active BTC oracles) served through a `/api/markets` route-handler gateway, with UP/DOWN odds computed from the on-chain SVI vol surface.

**Architecture:** UI → TanStack Query (10s polling) → `GET /api/markets` (Next.js route handler, 5s in-memory cache) → `@hunchbook/shared` indexer client → Mysten testnet indexer. Pricing is a pure client-side module (`svi.ts`): SVI total variance → `N(d2)` binary probability → payout odds with 1% router fee. Charts switch to the TradingView embed widget (brings its own data).

**Tech Stack:** Next.js 16 route handlers, `@hunchbook/shared` (workspace dep, raw TS — needs `transpilePackages`), TanStack Query, TradingView embed widget. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-06-10-live-market-data-design.md`

**Plan-level notes:**
- **No commits** (top-level `deepbook/` is not a git repo) and **no build/typecheck/lint runs** (user preference — user verifies via `pnpm web:dev` at the end). The only command run is the one-off SVI sanity script in Task 7.
- Verified live indexer facts (2026-06-10): BTC only; 4 active oracles; u64 prices scaled 1e9; `latest_svi` fields `a,b,rho,m,sigma` scaled 1e9 with `rho_negative`/`m_negative` flags; `GET /oracles/{id}/prices?limit=N` returns newest-first tick buffer.

---

### Task 1: Workspace dep + transpilePackages

**Files:**
- Modify: `web/package.json`
- Modify: `web/next.config.ts`

- [ ] **Step 1:** In `web/package.json` `"dependencies"`, add:

```json
"@hunchbook/shared": "workspace:*",
```

Then run `pnpm install` from the repo root (dependency wiring only — not a build).

- [ ] **Step 2:** Replace `web/next.config.ts` contents:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @hunchbook/shared ships raw TS source (exports ./src/index.ts)
  transpilePackages: ["@hunchbook/shared"],
};

export default nextConfig;
```

---

### Task 2: SVI pricing module

**Files:**
- Create: `web/src/lib/svi.ts`
- Delete: `web/src/lib/pricing.ts` (superseded; deleted in Task 6 after consumers are updated)

- [ ] **Step 1: Create `web/src/lib/svi.ts`**

```ts
/*
 * Binary option pricing from the on-chain SVI vol surface.
 * Ported from backtest/backtest.py Section 5.1 (UP = N(d2)), adapted to
 * total variance: the indexer's SVI params describe total implied variance
 * w(k) at log-moneyness k = ln(K/F), so no separate vol/ttm inputs needed.
 * Pure functions, no I/O.
 */

export interface SviParams {
  a: number;
  b: number;
  rho: number; // signed, decoded
  m: number; // signed, decoded
  sigma: number;
}

/** u64 fields on the indexer are scaled by 1e9. */
export const PRICE_SCALE = 1e9;

export function decodeScaled(value: number, negative = false): number {
  return (negative ? -1 : 1) * (value / PRICE_SCALE);
}

/** Raw indexer latest_svi event → decoded params. */
export function decodeSvi(raw: {
  a: number;
  b: number;
  rho: number;
  rho_negative: boolean;
  m: number;
  m_negative: boolean;
  sigma: number;
}): SviParams {
  return {
    a: decodeScaled(raw.a),
    b: decodeScaled(raw.b),
    rho: decodeScaled(raw.rho, raw.rho_negative),
    m: decodeScaled(raw.m, raw.m_negative),
    sigma: decodeScaled(raw.sigma),
  };
}

/** SVI total implied variance: w(k) = a + b(ρ(k−m) + √((k−m)² + σ²)). */
export function sviTotalVariance(k: number, p: SviParams): number {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sigma * p.sigma));
}

/** Standard normal CDF via Abramowitz–Stegun 7.1.26 erf approximation. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** P(settlement > strike) for a cash-or-nothing UP binary. */
export function binaryUpProbability(forward: number, strike: number, svi: SviParams): number {
  if (forward <= 0 || strike <= 0) return 0.5;
  const k = Math.log(strike / forward);
  const w = Math.max(sviTotalVariance(k, svi), 1e-12);
  const d2 = (Math.log(forward / strike) - w / 2) / Math.sqrt(w);
  return normalCdf(d2);
}

/** P(lower < settlement ≤ upper). */
export function rangeProbability(
  forward: number,
  lower: number,
  upper: number,
  svi: SviParams,
): number {
  if (upper <= lower) return 0;
  return Math.max(
    binaryUpProbability(forward, lower, svi) - binaryUpProbability(forward, upper, svi),
    0,
  );
}

const FEE = 0.01; // router fee, FEE_BPS = 100

/** Probability → payout multiplier net of the 1% router fee. */
export function probabilityToOdds(p: number): number {
  if (p <= 0.001) return 0;
  return ((1 / p) * (1 - FEE));
}
```

---

### Task 3: Live market types + gateway route handler

**Files:**
- Modify: `web/src/lib/types.ts` (replace `Market`, drop `Candle`)
- Create: `web/src/app/api/markets/route.ts`
- Delete: `web/src/lib/api/markets.ts` (mock — deleted in Task 6 after consumers are updated)

- [ ] **Step 1:** In `web/src/lib/types.ts`, replace the `Market` and `Candle` interfaces with:

```ts
import type { SviParams } from '@/lib/svi';

export interface LiveMarket {
  oracleId: string;
  pair: string; // 'BTC/USD'
  spot: number; // USD floats — decoded at the gateway
  forward: number;
  expiry: number; // unix ms
  minStrike: number;
  tickSize: number;
  svi: SviParams | null; // null if the oracle has no SVI fit yet
  sparkline: number[]; // recent spot ticks, oldest → newest
  sessionChangePct: number; // change over the tick buffer window
}
```

(Keep `Direction`, `VaultStats`, `VaultTransaction`, `LeaderboardPeriod`, `LeaderboardEntry`, `StreakInfo`, `AppNotification` unchanged.)

- [ ] **Step 2: Create `web/src/app/api/markets/route.ts`**

```ts
import { NextResponse } from 'next/server';
import {
  PREDICT_INDEXER_URL,
  getOracleState,
  listOracles,
  type IndexerOracleState,
} from '@hunchbook/shared';
import { decodeScaled, decodeSvi } from '@/lib/svi';
import type { LiveMarket } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5_000;
let cache: { data: LiveMarket[]; at: number } | null = null;

interface TickEvent {
  spot: number;
  checkpoint_timestamp_ms: number;
}

async function fetchTicks(oracleId: string): Promise<TickEvent[]> {
  const res = await fetch(`${PREDICT_INDEXER_URL}/oracles/${oracleId}/prices?limit=200`);
  if (!res.ok) return [];
  const ticks = (await res.json()) as TickEvent[];
  return ticks.reverse(); // newest-first → oldest-first
}

function toLiveMarket(state: IndexerOracleState, ticks: TickEvent[]): LiveMarket | null {
  const { oracle, latest_price, latest_svi } = state;
  if (!latest_price) return null;
  const sparkline = ticks.map((t) => decodeScaled(t.spot));
  const first = sparkline[0];
  const last = sparkline[sparkline.length - 1];
  return {
    oracleId: oracle.oracle_id,
    pair: `${oracle.underlying_asset}/USD`,
    spot: decodeScaled(latest_price.spot),
    forward: decodeScaled(latest_price.forward),
    expiry: oracle.expiry,
    minStrike: decodeScaled(oracle.min_strike),
    tickSize: decodeScaled(oracle.tick_size),
    svi: latest_svi
      ? decodeSvi(latest_svi as unknown as Parameters<typeof decodeSvi>[0])
      : null,
    sparkline,
    sessionChangePct: first ? ((last - first) / first) * 100 : 0,
  };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const oracles = await listOracles();
    const active = oracles
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.expiry - b.expiry);
    const markets = (
      await Promise.all(
        active.map(async (o) => {
          const [state, ticks] = await Promise.all([
            getOracleState(o.oracle_id),
            fetchTicks(o.oracle_id),
          ]);
          return toLiveMarket(state, ticks);
        }),
      )
    ).filter((m): m is LiveMarket => m !== null);
    cache = { data: markets, at: Date.now() };
    return NextResponse.json(markets);
  } catch (err) {
    if (cache) return NextResponse.json(cache.data); // stale-on-error
    return NextResponse.json(
      { error: `Predict indexer unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
```

---

### Task 4: Hooks + TradingView chart component

**Files:**
- Modify: `web/src/lib/hooks.ts` (replace `useMarkets`/`useCandles` with `useLiveMarkets`)
- Create: `web/src/components/charts/tradingview-chart.tsx`
- Delete: `web/src/components/charts/candle-chart.tsx` (Task 6, after pages stop importing it)

- [ ] **Step 1:** In `web/src/lib/hooks.ts`, replace the whole file:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchVaultStats, fetchVaultTransactions } from '@/lib/api/vault';
import { fetchLeaderboard, fetchNotifications, fetchStreak } from '@/lib/api/leaderboard';
import type { LeaderboardPeriod, LiveMarket } from '@/lib/types';

async function fetchLiveMarkets(): Promise<LiveMarket[]> {
  const res = await fetch('/api/markets');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `GET /api/markets → ${res.status}`);
  }
  return (await res.json()) as LiveMarket[];
}

export const useLiveMarkets = () =>
  useQuery({
    queryKey: ['live-markets'],
    queryFn: fetchLiveMarkets,
    refetchInterval: 10_000,
  });

export const useVaultStats = () => useQuery({ queryKey: ['vault-stats'], queryFn: fetchVaultStats });
export const useVaultTransactions = () =>
  useQuery({ queryKey: ['vault-transactions'], queryFn: fetchVaultTransactions });
export const useLeaderboard = (period: LeaderboardPeriod) =>
  useQuery({ queryKey: ['leaderboard', period], queryFn: () => fetchLeaderboard(period) });
export const useStreak = () => useQuery({ queryKey: ['streak'], queryFn: fetchStreak });
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });
```

- [ ] **Step 2: Create `web/src/components/charts/tradingview-chart.tsx`** (official embed widget; brings its own data)

```tsx
'use client';

import { useEffect, useRef } from 'react';

export function TradingViewChart({
  symbol = 'BINANCE:BTCUSDT',
  className = 'h-[420px] w-full',
}: {
  symbol?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      autosize: true,
      interval: '60',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      hide_top_toolbar: false,
      hide_legend: true,
      allow_symbol_change: false,
      save_image: false,
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
    };
  }, [symbol]);

  return <div ref={containerRef} className={className} />;
}
```

---

### Task 5: Trade screen on live data

**Files:**
- Modify: `web/src/components/trade/market-card.tsx` (full replacement)
- Modify: `web/src/components/trade/quick-bet-panel.tsx` (full replacement)
- Modify: `web/src/app/page.tsx` (full replacement)

- [ ] **Step 1: Replace `web/src/components/trade/market-card.tsx`**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/sparkline';
import { cn } from '@/lib/utils';
import { formatPct, formatUsd, timeUntil } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds } from '@/lib/svi';
import type { LiveMarket } from '@/lib/types';

export function marketOdds(market: LiveMarket): { up: number; down: number; pUp: number } {
  if (!market.svi) return { up: 0, down: 0, pUp: 0.5 };
  // ATM quote: strike at spot rounded to the oracle's tick size
  const strike = Math.round(market.spot / market.tickSize) * market.tickSize;
  const pUp = binaryUpProbability(market.forward, strike, market.svi);
  return { up: probabilityToOdds(pUp), down: probabilityToOdds(1 - pUp), pUp };
}

export function expiryLabel(market: LiveMarket): string {
  return new Date(market.expiry).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function MarketCard({
  market,
  onSelect,
}: {
  market: LiveMarket;
  onSelect: (oracleId: string) => void;
}) {
  const positive = market.sessionChangePct >= 0;
  const odds = marketOdds(market);
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-ring/50"
      onClick={() => onSelect(market.oracleId)}
    >
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {market.pair} — {expiryLabel(market)}
          </span>
          <Badge variant="secondary">{timeUntil(new Date(market.expiry).toISOString())}</Badge>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold">{formatUsd(market.spot)}</span>
          <span className={cn('text-sm font-medium', positive ? 'text-positive' : 'text-negative')}>
            {formatPct(market.sessionChangePct)}
          </span>
        </div>
        <Sparkline data={market.sparkline} positive={positive} />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-positive/40 text-positive hover:bg-positive/10"
          >
            UP {odds.up.toFixed(2)}x
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-negative/40 text-negative hover:bg-negative/10"
          >
            DOWN {odds.down.toFixed(2)}x
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Replace `web/src/components/trade/quick-bet-panel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPct } from '@/lib/format';
import type { Direction, LiveMarket } from '@/lib/types';
import { marketOdds, expiryLabel } from '@/components/trade/market-card';

export function QuickBetPanel({ market }: { market?: LiveMarket }) {
  const [direction, setDirection] = useState<Direction>('UP');
  const [stake, setStake] = useState('100');

  if (!market) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quick Bet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const odds = marketOdds(market);
  const mult = direction === 'UP' ? odds.up : odds.down;
  const pWin = direction === 'UP' ? odds.pUp : 1 - odds.pUp;
  const stakeNum = Number(stake) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Quick Bet — {market.pair} {expiryLabel(market)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={direction}
          onValueChange={(v) => v && setDirection(v as Direction)}
        >
          <ToggleGroupItem
            value="UP"
            className="flex-1 data-[state=on]:bg-positive/15 data-[state=on]:text-positive"
          >
            <ArrowUp className="size-4" /> UP {odds.up.toFixed(2)}x
          </ToggleGroupItem>
          <ToggleGroupItem
            value="DOWN"
            className="flex-1 data-[state=on]:bg-negative/15 data-[state=on]:text-negative"
          >
            <ArrowDown className="size-4" /> DOWN {odds.down.toFixed(2)}x
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Stake (dUSDC)</p>
          <Input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} />
        </div>

        <div className="rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Max payout</span>
            <span className="font-medium">{formatNumber(stakeNum * mult)} dUSDC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Win probability</span>
            <span className="font-medium">{formatPct(pWin * 100, false)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Priced from</span>
            <span className="font-medium">on-chain SVI surface</span>
          </div>
        </div>

        <Button className="w-full" size="lg">
          Place Bet
        </Button>
      </CardContent>
    </Card>
  );
}
```

(Risk-preset selector dropped — real pricing replaced it; YAGNI.)

- [ ] **Step 3: Replace `web/src/app/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TradingViewChart } from '@/components/charts/tradingview-chart';
import { MarketCard, expiryLabel } from '@/components/trade/market-card';
import { QuickBetPanel } from '@/components/trade/quick-bet-panel';
import { useLiveMarkets } from '@/lib/hooks';
import { formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function TradePage() {
  const markets = useLiveMarkets();
  const [oracleId, setOracleId] = useState<string>();
  const market =
    markets.data?.find((m) => m.oracleId === oracleId) ?? markets.data?.[0];

  return (
    <div className="space-y-6">
      {markets.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          Testnet data unavailable: {markets.error.message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            <Select value={market?.oracleId ?? ''} onValueChange={setOracleId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Loading markets…" />
              </SelectTrigger>
              <SelectContent>
                {markets.data?.map((m) => (
                  <SelectItem key={m.oracleId} value={m.oracleId}>
                    {m.pair} — {expiryLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {market ? (
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{formatUsd(market.spot)}</span>
                <span
                  className={cn(
                    'text-sm font-medium',
                    market.sessionChangePct >= 0 ? 'text-positive' : 'text-negative',
                  )}
                >
                  {formatPct(market.sessionChangePct)}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <TradingViewChart />
          </CardContent>
        </Card>
        <QuickBetPanel market={market} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Live Prediction Markets — Sui Testnet
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {markets.data
            ? markets.data.map((m) => (
                <MarketCard key={m.oracleId} market={m} onSelect={setOracleId} />
              ))
            : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </section>
    </div>
  );
}
```

---

### Task 6: Strike Studio on live data + mock cleanup

**Files:**
- Modify: `web/src/app/strike/page.tsx` (full replacement)
- Modify: `web/src/components/strike/strike-stepper.tsx` (full replacement — tick-size steps, min-strike clamp)
- Delete: `web/src/lib/api/markets.ts`, `web/src/lib/pricing.ts`, `web/src/components/charts/candle-chart.tsx`

- [ ] **Step 1: Replace `web/src/components/strike/strike-stepper.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function StrikeStepper({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, v);
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange(clamp(value - step))}>
          −{step.toLocaleString()}
        </Button>
        <Input
          inputMode="decimal"
          className="text-center font-mono"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => onChange(clamp(value + step))}>
          +{step.toLocaleString()}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `web/src/app/strike/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TradingViewChart } from '@/components/charts/tradingview-chart';
import { StrikeStepper } from '@/components/strike/strike-stepper';
import { useLiveMarkets } from '@/lib/hooks';
import { formatNumber, formatUsd } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds, rangeProbability } from '@/lib/svi';

export default function StrikeStudioPage() {
  const markets = useLiveMarkets();
  const market = markets.data?.[0]; // nearest expiry

  const [strike, setStrike] = useState(0);
  const [lower, setLower] = useState(0);
  const [upper, setUpper] = useState(0);
  const [wager, setWager] = useState('500');

  // Seed strikes from live spot once it arrives (round to $100)
  useEffect(() => {
    if (market && strike === 0) {
      const atm = Math.round(market.spot / 100) * 100;
      setStrike(atm);
      setLower(atm - 500);
      setUpper(atm + 500);
    }
  }, [market, strike]);

  if (!market || strike === 0) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[360px] w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const svi = market.svi;
  const strikeMult = svi
    ? probabilityToOdds(binaryUpProbability(market.forward, strike, svi))
    : 0;
  const rangeMult = svi
    ? probabilityToOdds(rangeProbability(market.forward, lower, upper, svi))
    : 0;
  const wagerNum = Number(wager) || 0;
  const step = Math.max(market.tickSize * 100, 100); // $100 steps ($1 tick × 100)

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{market.pair} Price Chart</CardTitle>
            <span className="text-2xl font-semibold">{formatUsd(market.spot)}</span>
          </CardHeader>
          <CardContent>
            <TradingViewChart className="h-[360px] w-full" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom Strike</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <StrikeStepper
              label={`Strike price (USD, min ${formatUsd(market.minStrike, 0)})`}
              value={strike}
              step={step}
              min={market.minStrike}
              onChange={setStrike}
            />
            <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Live re-pricing (SVI surface)</span>
              <Badge variant="secondary" className="text-accent-foreground">
                UP pays {strikeMult.toFixed(2)}x
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Range Bet</CardTitle>
            <Badge variant="secondary">Payout multiplier: {rangeMult.toFixed(2)}x</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <StrikeStepper
              label="Lower strike"
              value={lower}
              step={step}
              min={market.minStrike}
              onChange={setLower}
            />
            <StrikeStepper
              label="Upper strike"
              value={upper}
              step={step}
              min={market.minStrike}
              onChange={setUpper}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wager</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Wager amount (dUSDC)</p>
              <Input inputMode="decimal" value={wager} onChange={(e) => setWager(e.target.value)} />
            </div>
            <div className="flex justify-between rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Potential payout</span>
              <span className="font-medium">{formatNumber(wagerNum * rangeMult)} dUSDC</span>
            </div>
            <Button className="w-full" size="lg">
              Place Bet
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete superseded files**

```bash
rm web/src/lib/api/markets.ts web/src/lib/pricing.ts web/src/components/charts/candle-chart.tsx
```

(`lightweight-charts` stays in package.json — the vault NAV chart may move to it later; removing the dep is not worth the churn now.)

---

### Task 7: SVI sanity check

**Files:**
- Create: `web/scripts/svi-sanity.ts`

- [ ] **Step 1: Create `web/scripts/svi-sanity.ts`**

```ts
/*
 * One-off sanity check for the SVI pricing module, mirroring
 * backtest/backtest.py Section 5.1's printed checks.
 * Run: pnpm dlx tsx web/scripts/svi-sanity.ts  (from repo root)
 */
import { binaryUpProbability, normalCdf, probabilityToOdds, type SviParams } from '../src/lib/svi';

// Flat surface: a = total variance, b = 0 → constant vol regardless of k.
// vol 50% annualized over 30 min: w = 0.5^2 * (30 / (365*24*60)) ≈ 1.4269e-5
const flat: SviParams = { a: 0.25 * (30 / (365 * 24 * 60)), b: 0, rho: 0, m: 0, sigma: 0 };

const checks: [string, number, number, number][] = [
  // [label, actual, expected, tolerance]
  ['normalCdf(0) = 0.5', normalCdf(0), 0.5, 1e-6],
  ['normalCdf(1.96) ≈ 0.975', normalCdf(1.96), 0.975, 1e-3],
  ['ATM 30-min binary ≈ 0.5', binaryUpProbability(70_000, 70_000, flat), 0.5, 0.01],
  ['OTM +1% 30-min ≈ 0 (deep OTM at this vol)', binaryUpProbability(70_000, 70_700, flat), 0.0, 0.01],
  ['ITM −1% 30-min ≈ 1', binaryUpProbability(70_000, 69_300, flat), 1.0, 0.01],
  ['odds at p=0.5 ≈ 1.98 (2x minus 1% fee)', probabilityToOdds(0.5), 1.98, 1e-9],
];

let failed = 0;
for (const [label, actual, expected, tol] of checks) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual.toFixed(6)})`);
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it once**

Run from repo root: `pnpm dlx tsx web/scripts/svi-sanity.ts`
Expected: all `PASS`, exit 0. (This is the only command this plan runs — per user preference, no build/typecheck; the user verifies the app via `pnpm web:dev`.)

---

### Task 8: Hand-off verification (user-driven)

- [ ] **Step 1:** Tell the user the implementation is complete and that `pnpm web:dev` → `/` should show: 4 real BTC markets (spot ≈ live BTC testnet price ~$61k), expiry selector, TradingView chart, SVI-priced UP/DOWN odds; `/strike` should re-price on every stepper click; `/vault` and `/leaderboard` unchanged (mock). Network tab shows only `/api/markets` calls (no direct indexer calls from the browser).
