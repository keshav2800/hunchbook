# Hunchbook Web App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase C web UI — a Next.js 15 app in a new `web/` workspace package with a central CSS-variable theme, sidebar app shell, and four screens (Trade, Strike Studio, Vault, Leaderboard) running on a typed mock data layer.

**Architecture:** Next.js App Router app in the existing pnpm workspace. All look-and-feel flows from semantic CSS variables in one file (`src/styles/theme.css`). Screens consume TanStack Query hooks backed by deterministic mock fetchers in `src/lib/api/` — later DeepBook/zkLogin integration replaces fetcher bodies only.

**Tech Stack:** Next.js 15, TypeScript strict, Tailwind CSS v4, shadcn/ui, TanStack Query v5, lightweight-charts v5 (candles), Recharts (area charts/sparklines), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-10-web-app-foundation-design.md`

**Plan-level notes:**
- **No git commits.** Top-level `deepbook/` is intentionally not a git repository. Skip all commit steps; each task ends with a verification step instead.
- **No unit tests.** Per the approved spec, gates are `tsc --noEmit`, ESLint, `next build`, and visual browser verification against the Stitch reference PNGs in `/Users/keshav/Downloads/stitch/`.
- All commands run from `/Users/keshav/Downloads/deepbook` unless stated otherwise.

---

### Task 1: Scaffold Next.js app as workspace package

**Files:**
- Create: `web/` (via create-next-app)
- Modify: `web/package.json`, `pnpm-workspace.yaml`, `package.json` (root)

- [ ] **Step 1: Scaffold the app**

```bash
pnpm create next-app@latest web --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --use-pnpm --yes
```

Expected: `web/` created with Next 15, React 19, Tailwind v4, `src/app/` structure.

- [ ] **Step 2: Rename package and add typecheck script**

In `web/package.json` set:

```json
{
  "name": "@hunchbook/web",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  }
}
```

(Keep all other fields as generated.)

- [ ] **Step 3: Register in workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - shared
  - scripts
  - bot
  - web
```

Root `package.json` — add to `"scripts"`:

```json
"web:dev": "pnpm --filter @hunchbook/web dev",
"web:build": "pnpm --filter @hunchbook/web build",
"web:lint": "pnpm --filter @hunchbook/web lint",
"web:typecheck": "pnpm --filter @hunchbook/web typecheck"
```

- [ ] **Step 4: Install runtime deps**

```bash
pnpm --filter @hunchbook/web add @tanstack/react-query lightweight-charts recharts
pnpm install
```

- [ ] **Step 5: Verify**

```bash
pnpm web:typecheck && pnpm web:build
```

Expected: both succeed on the pristine scaffold.

---

### Task 2: shadcn init + central theme tokens

**Files:**
- Create: `web/src/styles/theme.css`
- Modify: `web/src/app/globals.css`
- Create (generated): `web/src/components/ui/*`, `web/src/lib/utils.ts`, `web/components.json`, `web/src/hooks/use-mobile.ts`

- [ ] **Step 1: Init shadcn and add components**

```bash
cd web
pnpm dlx shadcn@latest init --yes --base-color slate
pnpm dlx shadcn@latest add button card input select table tabs badge separator skeleton sidebar tooltip toggle-group
```

Expected: `components.json` plus `src/components/ui/*.tsx` (sidebar pulls in sheet/skeleton/etc. automatically).

- [ ] **Step 2: Create `web/src/styles/theme.css`** — the single source of truth for the app's look:

```css
/*
 * Hunchbook theme — single source of truth.
 * Edit values here to retheme the entire app (components + charts).
 */
:root {
  --radius: 0.75rem;

  /* Core surfaces */
  --background: #070f1e;
  --foreground: #e6efff;
  --card: #0c1a30;
  --card-foreground: #e6efff;
  --popover: #0c1a30;
  --popover-foreground: #e6efff;
  --surface: var(--card);
  --surface-elevated: #122441;

  /* Brand */
  --primary: #3b82f6;
  --primary-foreground: #f4f9ff;
  --secondary: #13233f;
  --secondary-foreground: #c7d8f0;
  --muted: #11203a;
  --muted-foreground: #87a1c4;
  --accent: #153052;
  --accent-foreground: #7dd3fc;
  --destructive: #f43f5e;

  /* Lines & focus */
  --border: #1b2f4f;
  --input: #16294a;
  --ring: #38bdf8;

  /* Domain semantics */
  --positive: #10b981; /* UP / profit */
  --negative: #f43f5e; /* DOWN / loss */
  --warning: #f59e0b;

  /* Charts (also read by JS via getComputedStyle) */
  --chart-1: #38bdf8;
  --chart-2: #818cf8;
  --chart-3: #10b981;
  --chart-4: #f59e0b;
  --chart-5: #f43f5e;

  /* Sidebar */
  --sidebar: #091527;
  --sidebar-foreground: #c7d8f0;
  --sidebar-primary: #3b82f6;
  --sidebar-primary-foreground: #f4f9ff;
  --sidebar-accent: #13233f;
  --sidebar-accent-foreground: #e6efff;
  --sidebar-border: #1b2f4f;
  --sidebar-ring: #38bdf8;
}
```

- [ ] **Step 3: Wire it into `globals.css`**

In `web/src/app/globals.css`:
1. Delete the generated `:root { ... }` and `.dark { ... }` blocks (theme.css replaces them).
2. Add `@import "../styles/theme.css";` immediately after the `@import "tailwindcss";` / `tw-animate-css` imports.
3. In the existing `@theme inline { ... }` block, add the custom token mappings:

```css
  --color-positive: var(--positive);
  --color-negative: var(--negative);
  --color-warning: var(--warning);
  --color-surface: var(--surface);
  --color-surface-elevated: var(--surface-elevated);
```

(Keep all generated `--color-*: var(--*)` mappings and the `@layer base` block as-is.)

- [ ] **Step 4: Verify**

```bash
pnpm web:typecheck && pnpm web:build
```

Expected: success. Then `pnpm web:dev`, open http://localhost:3000 — default page renders on deep-navy background.

---

### Task 3: Types, formatting, pricing, mock API, hooks

**Files:**
- Create: `web/src/lib/types.ts`, `web/src/lib/format.ts`, `web/src/lib/pricing.ts`, `web/src/lib/mock-utils.ts`, `web/src/lib/api/markets.ts`, `web/src/lib/api/vault.ts`, `web/src/lib/api/leaderboard.ts`, `web/src/lib/hooks.ts`, `web/src/app/providers.tsx`
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: `web/src/lib/types.ts`**

```ts
export type Direction = 'UP' | 'DOWN';

export interface Market {
  id: string;
  pair: string; // e.g. 'BTC/USD'
  spotPrice: number;
  change24hPct: number;
  expiresAt: string; // ISO
  upOdds: number; // payout multiplier
  downOdds: number;
  winProbabilityPct: number;
  sparkline: number[];
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VaultStats {
  tvlUsd: number;
  sharePrice: number;
  sharePriceChangePct: number;
  userPositionUsd: number;
  apyPct: number;
  history: { date: string; nav: number; drawdownPct: number }[];
  hedgeComposition: { label: string; pct: number }[];
}

export interface VaultTransaction {
  id: string;
  type: 'Deposit' | 'Withdraw';
  amount: number;
  token: string;
  date: string;
  status: 'Completed' | 'Pending';
}

export type LeaderboardPeriod = 'weekly' | 'all-time';

export interface LeaderboardEntry {
  rank: number;
  username: string;
  winRatePct: number;
  points: number;
}

export interface StreakInfo {
  currentDays: number;
  milestones: number[]; // [3, 7, 14, 30]
}

export interface AppNotification {
  id: string;
  kind: 'bet' | 'streak' | 'vault' | 'system';
  title: string;
  body: string;
  time: string; // human-readable, e.g. '2h ago'
}
```

- [ ] **Step 2: `web/src/lib/format.ts`**

```ts
export function formatUsd(value: number, digits = 2): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  });
}

export function formatCompactUsd(value: number): string {
  return `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;
}

export function formatPct(value: number, signed = true): string {
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

- [ ] **Step 3: `web/src/lib/pricing.ts`** — mock pricing curves (replaced by real quoting later):

```ts
/** Further from spot = higher payout. Clamped to [1.05, 9.9]. */
export function strikePayoutMultiplier(spot: number, strike: number): number {
  const distancePct = Math.abs(strike - spot) / spot;
  return Math.min(9.9, Math.max(1.05, 1 + distancePct * 40));
}

/** Narrower range = higher payout. Returns 0 for invalid ranges. */
export function rangePayoutMultiplier(spot: number, lower: number, upper: number): number {
  if (upper <= lower || spot <= 0) return 0;
  const widthPct = ((upper - lower) / spot) * 100;
  return Math.min(9.9, Math.max(1.1, 4 / (widthPct + 0.4)));
}
```

- [ ] **Step 4: `web/src/lib/mock-utils.ts`** — deterministic PRNG so mock data is stable across refetches (no flicker, no hydration drift):

```ts
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(s: string): number {
  return [...s].reduce((acc, ch) => acc + ch.charCodeAt(0) * 31, 7);
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

- [ ] **Step 5: `web/src/lib/api/markets.ts`**

```ts
import type { Candle, Market } from '@/lib/types';
import { delay, mulberry32, seedFrom } from '@/lib/mock-utils';

export const PAIRS: { pair: string; base: number }[] = [
  { pair: 'BTC/USD', base: 67250 },
  { pair: 'ETH/USD', base: 3410.45 },
  { pair: 'SUI/USD', base: 1.245 },
  { pair: 'SOL/USD', base: 152.3 },
  { pair: 'DOGE/USD', base: 0.142 },
  { pair: 'DEEP/USD', base: 0.061 },
];

export function generateCandles(pair: string, count = 120): Candle[] {
  const base = PAIRS.find((p) => p.pair === pair)?.base ?? 100;
  const rand = mulberry32(seedFrom(pair));
  const nowHour = Math.floor(Date.now() / 3_600_000) * 3600;
  const candles: Candle[] = [];
  let close = base * (0.92 + rand() * 0.08);
  for (let i = count - 1; i >= 0; i--) {
    const open = close;
    close = open + (rand() - 0.48) * 0.012 * open;
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    candles.push({ time: nowHour - i * 3600, open, high, low, close });
  }
  return candles;
}

export async function fetchMarkets(): Promise<Market[]> {
  await delay(300);
  return PAIRS.map(({ pair, base }, idx) => {
    const rand = mulberry32(seedFrom(pair) + 1);
    return {
      id: pair.toLowerCase().replace('/', '-'),
      pair,
      spotPrice: base,
      change24hPct: (rand() - 0.45) * 6,
      expiresAt: new Date(Date.now() + (idx + 1) * 3_600_000).toISOString(),
      upOdds: 1.6 + rand() * 0.9,
      downOdds: 1.6 + rand() * 0.9,
      winProbabilityPct: 40 + rand() * 25,
      sparkline: Array.from(
        { length: 24 },
        (_, i) => base * (1 + Math.sin(i / 4 + idx) * 0.01 + (rand() - 0.5) * 0.008),
      ),
    };
  });
}

export async function fetchCandles(pair: string): Promise<Candle[]> {
  await delay(250);
  return generateCandles(pair);
}
```

- [ ] **Step 6: `web/src/lib/api/vault.ts`**

```ts
import type { VaultStats, VaultTransaction } from '@/lib/types';
import { delay, mulberry32 } from '@/lib/mock-utils';

export async function fetchVaultStats(): Promise<VaultStats> {
  await delay(300);
  const rand = mulberry32(42);
  const history: VaultStats['history'] = [];
  let nav = 8_200_000;
  let peak = nav;
  for (let i = 179; i >= 0; i--) {
    nav *= 1 + (rand() - 0.46) * 0.01;
    peak = Math.max(peak, nav);
    const d = new Date(Date.now() - i * 86_400_000);
    history.push({
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      nav: Math.round(nav),
      drawdownPct: -(((peak - nav) / peak) * 100),
    });
  }
  return {
    tvlUsd: nav,
    sharePrice: 1.125,
    sharePriceChangePct: 2.4,
    userPositionUsd: 25_000,
    apyPct: 12.5,
    history,
    hedgeComposition: [
      { label: 'DeepBook PLP', pct: 55 },
      { label: 'Perp Hedge', pct: 30 },
      { label: 'USDC Buffer', pct: 15 },
    ],
  };
}

export async function fetchVaultTransactions(): Promise<VaultTransaction[]> {
  await delay(250);
  return [
    { id: 'tx-1', type: 'Deposit', amount: 500, token: 'USDC', date: '2026-06-09', status: 'Completed' },
    { id: 'tx-2', type: 'Withdraw', amount: 1200, token: 'USDC', date: '2026-06-07', status: 'Completed' },
    { id: 'tx-3', type: 'Deposit', amount: 4300, token: 'SUI', date: '2026-06-05', status: 'Completed' },
    { id: 'tx-4', type: 'Deposit', amount: 250, token: 'USDC', date: '2026-06-04', status: 'Pending' },
    { id: 'tx-5', type: 'Withdraw', amount: 800, token: 'SUI', date: '2026-06-01', status: 'Completed' },
  ];
}
```

- [ ] **Step 7: `web/src/lib/api/leaderboard.ts`**

```ts
import type { AppNotification, LeaderboardEntry, LeaderboardPeriod, StreakInfo } from '@/lib/types';
import { delay, mulberry32 } from '@/lib/mock-utils';

const USERNAMES = [
  '@CryptoOracle', '@SuiPredictor', '@MarketSeer_X', '@ChainLinker',
  '@DeltaHunter', '@OddsMaven', '@Sui_monitor', '@TickTrader',
];

export async function fetchLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardEntry[]> {
  await delay(300);
  const rand = mulberry32(period === 'weekly' ? 11 : 99);
  return USERNAMES.map((username, i) => ({
    rank: i + 1,
    username,
    winRatePct: 80 - i * 3 - rand() * 4,
    points: Math.round((9_000_000 - i * 950_000) * (0.9 + rand() * 0.2) * (period === 'weekly' ? 0.01 : 1)),
  }));
}

export async function fetchStreak(): Promise<StreakInfo> {
  await delay(150);
  return { currentDays: 7, milestones: [3, 7, 14, 30] };
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  await delay(200);
  return [
    { id: 'n1', kind: 'bet', title: 'Bet Settled', body: 'Your prediction on BTC > $67k won. +250 SUI credited.', time: '2h ago' },
    { id: 'n2', kind: 'streak', title: 'Streak Milestone', body: 'You reached a 7-day prediction streak. Payout boost unlocked.', time: '5h ago' },
    { id: 'n3', kind: 'vault', title: 'Hedge Rebalanced', body: 'Vault hedge ratio adjusted to 30% after volatility spike.', time: '1d ago' },
    { id: 'n4', kind: 'system', title: 'New Market Live', body: 'DEEP/USD hourly prediction market is now open.', time: '2d ago' },
  ];
}
```

- [ ] **Step 8: `web/src/lib/hooks.ts`**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchCandles, fetchMarkets } from '@/lib/api/markets';
import { fetchVaultStats, fetchVaultTransactions } from '@/lib/api/vault';
import { fetchLeaderboard, fetchNotifications, fetchStreak } from '@/lib/api/leaderboard';
import type { LeaderboardPeriod } from '@/lib/types';

export const useMarkets = () => useQuery({ queryKey: ['markets'], queryFn: fetchMarkets });
export const useCandles = (pair: string) =>
  useQuery({ queryKey: ['candles', pair], queryFn: () => fetchCandles(pair) });
export const useVaultStats = () => useQuery({ queryKey: ['vault-stats'], queryFn: fetchVaultStats });
export const useVaultTransactions = () =>
  useQuery({ queryKey: ['vault-transactions'], queryFn: fetchVaultTransactions });
export const useLeaderboard = (period: LeaderboardPeriod) =>
  useQuery({ queryKey: ['leaderboard', period], queryFn: () => fetchLeaderboard(period) });
export const useStreak = () => useQuery({ queryKey: ['streak'], queryFn: fetchStreak });
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });
```

- [ ] **Step 9: `web/src/app/providers.tsx`**

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 10: Wrap layout** — in `web/src/app/layout.tsx`, import `Providers` and wrap `{children}`; set `<html lang="en" className="dark">`; update metadata:

```tsx
export const metadata: Metadata = {
  title: 'Hunchbook',
  description: 'Prediction markets and liquidity vault on Sui / DeepBook',
};
```

- [ ] **Step 11: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Expected: clean.

---

### Task 4: App shell (sidebar + top bar)

**Files:**
- Create: `web/src/components/app-shell/app-sidebar.tsx`, `web/src/components/app-shell/top-bar.tsx`
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: `web/src/components/app-shell/app-sidebar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChartCandlestick, Crosshair, Landmark, Trophy, Waves } from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from '@/components/ui/sidebar';

const NAV_ITEMS = [
  { title: 'Trade', href: '/', icon: ChartCandlestick },
  { title: 'Strike Studio', href: '/strike', icon: Crosshair },
  { title: 'Vault', href: '/vault', icon: Landmark },
  { title: 'Leaderboard', href: '/leaderboard', icon: Trophy },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Waves className="size-6 text-accent-foreground" />
          <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Hunchbook
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

- [ ] **Step 2: `web/src/components/app-shell/top-bar.tsx`**

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

const TITLES: Record<string, string> = {
  '/': 'Prediction Market',
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
        {/* Visual stub — replaced by zkLogin in a later task */}
        <Button size="sm">
          <Wallet className="size-4" />
          Connect Wallet
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Final `web/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { TopBar } from '@/components/app-shell/top-bar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hunchbook',
  description: 'Prediction markets and liquidity vault on Sui / DeepBook',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <TopBar />
              <main className="flex-1 p-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Then in the dev server: sidebar with 4 items renders, collapses via trigger, top bar shows title + Connect Wallet.

---

### Task 5: Shared chart/stat components

**Files:**
- Create: `web/src/components/charts/candle-chart.tsx`, `web/src/components/charts/sparkline.tsx`, `web/src/components/stat-card.tsx`, `web/src/lib/css-var.ts`

- [ ] **Step 1: `web/src/lib/css-var.ts`**

```ts
/** Read a theme token at runtime so charts follow theme.css. Client-only. */
export function cssVar(name: string): string {
  if (typeof window === 'undefined') return '#888888';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
}
```

- [ ] **Step 2: `web/src/components/charts/candle-chart.tsx`** (lightweight-charts v5 API: `chart.addSeries(CandlestickSeries, opts)`)

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/lib/types';
import { cssVar } from '@/lib/css-var';

export function CandleChart({ data, className = 'h-[420px] w-full' }: { data: Candle[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssVar('--muted-foreground'),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar('--border') },
        horzLines: { color: cssVar('--border') },
      },
      rightPriceScale: { borderColor: cssVar('--border') },
      timeScale: { borderColor: cssVar('--border'), timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar('--positive'),
      downColor: cssVar('--negative'),
      wickUpColor: cssVar('--positive'),
      wickDownColor: cssVar('--negative'),
      borderVisible: false,
    });
    series.setData(data.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data]);

  return <div ref={containerRef} className={className} />;
}
```

- [ ] **Step 3: `web/src/components/charts/sparkline.tsx`**

```tsx
'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const color = positive ? 'var(--positive)' : 'var(--negative)';
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          dataKey="v" type="monotone" stroke={color} strokeWidth={1.5}
          fill={color} fillOpacity={0.15} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: `web/src/components/stat-card.tsx`**

```tsx
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label, value, sub, subClassName,
}: { label: string; value: string; sub?: string; subClassName?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {sub ? <p className={cn('text-sm', subClassName)}>{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

---

### Task 6: Trade screen (`/`)

Reference: `/Users/keshav/Downloads/stitch/prediction_market_trading_dashboard/screen.png`

**Files:**
- Create: `web/src/components/trade/quick-bet-panel.tsx`, `web/src/components/trade/market-card.tsx`
- Replace: `web/src/app/page.tsx`

- [ ] **Step 1: `web/src/components/trade/quick-bet-panel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber, formatPct } from '@/lib/format';
import type { Direction, Market } from '@/lib/types';

const RISK_PRESETS = ['Conservative', 'Moderate', 'Degen'] as const;

export function QuickBetPanel({ market }: { market?: Market }) {
  const [direction, setDirection] = useState<Direction>('UP');
  const [stake, setStake] = useState('100');
  const [risk, setRisk] = useState<(typeof RISK_PRESETS)[number]>('Moderate');

  if (!market) {
    return (
      <Card>
        <CardHeader><CardTitle>Quick Bet</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const odds = direction === 'UP' ? market.upOdds : market.downOdds;
  const stakeNum = Number(stake) || 0;
  const payout = stakeNum * odds;

  return (
    <Card>
      <CardHeader><CardTitle>Quick Bet — {market.pair}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          type="single" variant="outline" className="w-full"
          value={direction}
          onValueChange={(v) => v && setDirection(v as Direction)}
        >
          <ToggleGroupItem value="UP" className="flex-1 data-[state=on]:bg-positive/15 data-[state=on]:text-positive">
            <ArrowUp className="size-4" /> UP {market.upOdds.toFixed(2)}x
          </ToggleGroupItem>
          <ToggleGroupItem value="DOWN" className="flex-1 data-[state=on]:bg-negative/15 data-[state=on]:text-negative">
            <ArrowDown className="size-4" /> DOWN {market.downOdds.toFixed(2)}x
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Stake (SUI)</p>
          <Input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Risk preset</p>
          <Select value={risk} onValueChange={(v) => setRisk(v as typeof risk)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RISK_PRESETS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Max payout</span>
            <span className="font-medium">{formatNumber(payout)} SUI</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Win probability</span>
            <span className="font-medium">{formatPct(market.winProbabilityPct, false)}</span>
          </div>
        </div>

        <Button className="w-full" size="lg">Place Bet</Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `web/src/components/trade/market-card.tsx`**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/sparkline';
import { cn } from '@/lib/utils';
import { formatPct, formatUsd, timeUntil } from '@/lib/format';
import type { Market } from '@/lib/types';

export function MarketCard({ market, onSelect }: { market: Market; onSelect: (pair: string) => void }) {
  const positive = market.change24hPct >= 0;
  return (
    <Card className="cursor-pointer transition-colors hover:border-ring/50" onClick={() => onSelect(market.pair)}>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{market.pair}</span>
          <Badge variant="secondary">{timeUntil(market.expiresAt)}</Badge>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold">{formatUsd(market.spotPrice, market.spotPrice < 10 ? 4 : 2)}</span>
          <span className={cn('text-sm font-medium', positive ? 'text-positive' : 'text-negative')}>
            {formatPct(market.change24hPct)}
          </span>
        </div>
        <Sparkline data={market.sparkline} positive={positive} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="border-positive/40 text-positive hover:bg-positive/10">
            UP {market.upOdds.toFixed(2)}x
          </Button>
          <Button variant="outline" size="sm" className="border-negative/40 text-negative hover:bg-negative/10">
            DOWN {market.downOdds.toFixed(2)}x
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Replace `web/src/app/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CandleChart } from '@/components/charts/candle-chart';
import { MarketCard } from '@/components/trade/market-card';
import { QuickBetPanel } from '@/components/trade/quick-bet-panel';
import { useCandles, useMarkets } from '@/lib/hooks';
import { formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function TradePage() {
  const [pair, setPair] = useState('BTC/USD');
  const markets = useMarkets();
  const candles = useCandles(pair);
  const market = markets.data?.find((m) => m.pair === pair);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            <Select value={pair} onValueChange={setPair}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {markets.data?.map((m) => <SelectItem key={m.id} value={m.pair}>{m.pair}</SelectItem>)}
              </SelectContent>
            </Select>
            {market ? (
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">{formatUsd(market.spotPrice, market.spotPrice < 10 ? 4 : 2)}</span>
                <span className={cn('text-sm font-medium', market.change24hPct >= 0 ? 'text-positive' : 'text-negative')}>
                  {formatPct(market.change24hPct)}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            {candles.data ? <CandleChart data={candles.data} /> : <Skeleton className="h-[420px] w-full" />}
          </CardContent>
        </Card>
        <QuickBetPanel market={market} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Live Prediction Markets
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {markets.data
            ? markets.data.map((m) => <MarketCard key={m.id} market={m} onSelect={setPair} />)
            : Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Browser: candlestick chart renders, pair selector swaps chart + Quick Bet, market cards show sparklines and odds. Compare against the Stitch reference PNG.

---

### Task 7: Strike Studio (`/strike`)

Reference: `/Users/keshav/Downloads/stitch/strike_studio_custom_picker/screen.png`

**Files:**
- Create: `web/src/components/strike/strike-stepper.tsx`, `web/src/app/strike/page.tsx`

- [ ] **Step 1: `web/src/components/strike/strike-stepper.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function StrikeStepper({
  label, value, step, onChange,
}: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange(value - step)}>
          −{step.toLocaleString()}
        </Button>
        <Input
          inputMode="decimal"
          className="text-center font-mono"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => onChange(value + step)}>
          +{step.toLocaleString()}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `web/src/app/strike/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CandleChart } from '@/components/charts/candle-chart';
import { StrikeStepper } from '@/components/strike/strike-stepper';
import { useCandles, useMarkets } from '@/lib/hooks';
import { formatNumber, formatUsd } from '@/lib/format';
import { rangePayoutMultiplier, strikePayoutMultiplier } from '@/lib/pricing';

const PAIR = 'BTC/USD';

export default function StrikeStudioPage() {
  const markets = useMarkets();
  const candles = useCandles(PAIR);
  const spot = markets.data?.find((m) => m.pair === PAIR)?.spotPrice ?? 0;

  const [strike, setStrike] = useState(67500);
  const [lower, setLower] = useState(66500);
  const [upper, setUpper] = useState(68000);
  const [wager, setWager] = useState('500');

  const strikeMult = spot ? strikePayoutMultiplier(spot, strike) : 0;
  const rangeMult = spot ? rangePayoutMultiplier(spot, lower, upper) : 0;
  const wagerNum = Number(wager) || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{PAIR} Price Chart</CardTitle>
            {spot ? <span className="text-2xl font-semibold">{formatUsd(spot)}</span> : null}
          </CardHeader>
          <CardContent>
            {candles.data ? <CandleChart data={candles.data} className="h-[360px] w-full" /> : <Skeleton className="h-[360px] w-full" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Custom Strike</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <StrikeStepper label="Strike price (USD)" value={strike} step={1000} onChange={setStrike} />
            <div className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Live re-pricing</span>
              <Badge variant="secondary" className="text-accent-foreground">
                {strikeMult.toFixed(2)}x payout
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
            <StrikeStepper label="Lower strike" value={lower} step={1000} onChange={setLower} />
            <StrikeStepper label="Upper strike" value={upper} step={1000} onChange={setUpper} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Wager</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Wager amount (SUI)</p>
              <Input inputMode="decimal" value={wager} onChange={(e) => setWager(e.target.value)} />
            </div>
            <div className="flex justify-between rounded-lg bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Potential payout</span>
              <span className="font-medium">{formatNumber(wagerNum * rangeMult)} SUI</span>
            </div>
            <Button className="w-full" size="lg">Place Bet</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Browser: steppers adjust strikes, multipliers re-price live, potential payout updates with wager. Compare against the Stitch reference PNG.

---

### Task 8: Vault (`/vault`)

Reference: `/Users/keshav/Downloads/stitch/liquidity_vault_lp_dashboard/screen.png`

**Files:**
- Create: `web/src/components/vault/nav-chart.tsx`, `web/src/components/vault/deposit-withdraw.tsx`, `web/src/app/vault/page.tsx`

- [ ] **Step 1: `web/src/components/vault/nav-chart.tsx`**

```tsx
'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactUsd } from '@/lib/format';
import type { VaultStats } from '@/lib/types';

export function NavChart({ history }: { history: VaultStats['history'] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} minTickGap={48} fontSize={12} />
        <YAxis yAxisId="nav" orientation="right" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickFormatter={formatCompactUsd} width={70} fontSize={12} />
        <YAxis yAxisId="dd" hide domain={[-40, 0]} />
        <Tooltip
          contentStyle={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)' }}
          formatter={(value, name) =>
            name === 'NAV' ? [formatCompactUsd(Number(value)), 'NAV'] : [`${Number(value).toFixed(2)}%`, 'Drawdown']
          }
        />
        <Area yAxisId="nav" name="NAV" dataKey="nav" type="monotone" stroke="var(--chart-1)" strokeWidth={2} fill="url(#navFill)" isAnimationActive={false} />
        <Area yAxisId="dd" name="Drawdown" dataKey="drawdownPct" type="monotone" stroke="var(--chart-5)" strokeWidth={1.5} fill="var(--chart-5)" fillOpacity={0.08} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: `web/src/components/vault/deposit-withdraw.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TOKENS = ['USDC', 'SUI'] as const;

function AmountForm({ action }: { action: 'Deposit' | 'Withdraw' }) {
  const [token, setToken] = useState<(typeof TOKENS)[number]>('USDC');
  const [amount, setAmount] = useState('');
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={token} onValueChange={(v) => setToken(v as typeof token)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TOKENS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Button className="w-full">{action}</Button>
    </div>
  );
}

export function DepositWithdraw() {
  return (
    <Card>
      <CardHeader><CardTitle>Manage Position</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue="deposit">
          <TabsList className="w-full">
            <TabsTrigger value="deposit" className="flex-1">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw" className="flex-1">Withdraw</TabsTrigger>
          </TabsList>
          <TabsContent value="deposit" className="pt-4"><AmountForm action="Deposit" /></TabsContent>
          <TabsContent value="withdraw" className="pt-4"><AmountForm action="Withdraw" /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `web/src/app/vault/page.tsx`**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatCard } from '@/components/stat-card';
import { NavChart } from '@/components/vault/nav-chart';
import { DepositWithdraw } from '@/components/vault/deposit-withdraw';
import { useVaultStats, useVaultTransactions } from '@/lib/hooks';
import { formatCompactUsd, formatNumber, formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

const COMPOSITION_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)'];

export default function VaultPage() {
  const stats = useVaultStats();
  const txs = useVaultTransactions();

  if (!stats.data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Value Locked" value={formatCompactUsd(s.tvlUsd)} sub={`APY ${formatPct(s.apyPct, false)}`} subClassName="text-positive" />
        <StatCard label="Share Price" value={s.sharePrice.toFixed(3)} sub={formatPct(s.sharePriceChangePct)} subClassName={s.sharePriceChangePct >= 0 ? 'text-positive' : 'text-negative'} />
        <StatCard label="Your Position" value={formatUsd(s.userPositionUsd, 0)} sub="0 pending withdrawals" subClassName="text-muted-foreground" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><CardTitle>Historical NAV & Drawdown</CardTitle></CardHeader>
          <CardContent><NavChart history={s.history} /></CardContent>
        </Card>

        <div className="space-y-6">
          <DepositWithdraw />
          <Card>
            <CardHeader><CardTitle>Hedge Composition</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {s.hedgeComposition.map((c, i) => (
                <div key={c.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{c.label}</span>
                    <span className="text-muted-foreground">{c.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full" style={{ width: `${c.pct}%`, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length] }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Vault Transactions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(txs.data ?? []).map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className={cn('font-medium', tx.type === 'Deposit' ? 'text-positive' : 'text-negative')}>
                    {tx.type}
                  </TableCell>
                  <TableCell>{formatNumber(tx.amount)} {tx.token}</TableCell>
                  <TableCell className="text-muted-foreground">{tx.date}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={tx.status === 'Completed' ? 'text-positive' : 'text-warning'}>
                      {tx.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Browser: stat cards, NAV/drawdown chart with tooltip, hedge bars, deposit/withdraw tabs, transactions table. Compare against the Stitch reference PNG.

---

### Task 9: Leaderboard (`/leaderboard`)

Reference: `/Users/keshav/Downloads/stitch/leaderboard_gamification_center/screen.png`

**Files:**
- Create: `web/src/components/leaderboard/streak-counter.tsx`, `web/src/components/leaderboard/notifications-panel.tsx`, `web/src/app/leaderboard/page.tsx`

- [ ] **Step 1: `web/src/components/leaderboard/streak-counter.tsx`**

```tsx
'use client';

import { Flame, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StreakInfo } from '@/lib/types';

export function StreakCounter({ streak }: { streak: StreakInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Streak Counter</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          {streak.milestones.map((days) => {
            const unlocked = streak.currentDays >= days;
            const isCurrent = unlocked && days === Math.max(...streak.milestones.filter((m) => m <= streak.currentDays));
            return (
              <div key={days} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={cn(
                    'flex size-16 items-center justify-center rounded-full border-2',
                    unlocked ? 'border-ring bg-accent text-accent-foreground' : 'border-border bg-muted text-muted-foreground',
                    isCurrent && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  {unlocked ? <Flame className="size-6" /> : <Lock className="size-5" />}
                </div>
                <span className="text-sm font-medium">{days} Day</span>
                <span className="text-xs text-muted-foreground">{unlocked ? 'Unlocked' : 'Locked'}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Current streak: <span className="font-medium text-foreground">{streak.currentDays} days</span> — keep predicting daily to unlock higher rewards.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `web/src/components/leaderboard/notifications-panel.tsx`**

```tsx
'use client';

import { Bell, Flame, Landmark, Megaphone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppNotification } from '@/lib/types';

const ICONS: Record<AppNotification['kind'], typeof Bell> = {
  bet: Bell,
  streak: Flame,
  vault: Landmark,
  system: Megaphone,
};

export function NotificationsPanel({ notifications }: { notifications: AppNotification[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {notifications.map((n) => {
          const Icon = ICONS[n.kind];
          return (
            <div key={n.id} className="flex gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-0.5 text-xs text-muted-foreground/70">{n.time}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `web/src/app/leaderboard/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StreakCounter } from '@/components/leaderboard/streak-counter';
import { NotificationsPanel } from '@/components/leaderboard/notifications-panel';
import { useLeaderboard, useNotifications, useStreak } from '@/lib/hooks';
import { formatNumber, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LeaderboardPeriod } from '@/lib/types';

const MEDAL_COLORS = ['text-warning', 'text-muted-foreground', 'text-accent-foreground'];

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');
  const leaderboard = useLeaderboard(period);
  const streak = useStreak();
  const notifications = useNotifications();

  return (
    <div className="space-y-6">
      {streak.data ? <StreakCounter streak={streak.data} /> : <Skeleton className="h-48 w-full" />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Global Leaderboard</CardTitle>
            <Tabs value={period} onValueChange={(v) => setPeriod(v as LeaderboardPeriod)}>
              <TabsList>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="all-time">All-Time</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {leaderboard.data ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.data.map((entry) => (
                    <TableRow key={entry.username}>
                      <TableCell className={cn('font-semibold', entry.rank <= 3 && MEDAL_COLORS[entry.rank - 1])}>
                        #{entry.rank}
                      </TableCell>
                      <TableCell className="font-medium">{entry.username}</TableCell>
                      <TableCell className="text-right">{formatPct(entry.winRatePct, false)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatNumber(entry.points, 0)} Pts
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Skeleton className="h-96 w-full" />
            )}
          </CardContent>
        </Card>

        {notifications.data ? <NotificationsPanel notifications={notifications.data} /> : <Skeleton className="h-96 w-full" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
pnpm web:typecheck && pnpm web:lint
```

Browser: streak medallions (7-day current, 14/30 locked), weekly/all-time tabs swap data, notifications panel. Compare against the Stitch reference PNG.

---

### Task 10: Final verification

- [ ] **Step 1: Full gates**

```bash
pnpm web:typecheck && pnpm web:lint && pnpm web:build
```

Expected: all pass, build outputs 4 routes (`/`, `/strike`, `/vault`, `/leaderboard`).

- [ ] **Step 2: Browser walkthrough**

Run `pnpm web:dev`. Visit each route; verify against the corresponding Stitch PNG:
- `/` — chart + quick bet + market grid
- `/strike` — strike steppers + range bet + wager
- `/vault` — stats + NAV chart + manage position + transactions
- `/leaderboard` — streaks + rankings + notifications

Also verify: sidebar collapse works, active nav state follows route, no console errors.

- [ ] **Step 3: Theme configurability proof**

Temporarily change `--primary` in `web/src/styles/theme.css` to e.g. `#a855f7`, confirm buttons/sidebar accents change everywhere, then revert. This proves the "edit one file to retheme" requirement.
