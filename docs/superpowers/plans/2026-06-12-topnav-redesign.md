# Top Nav Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar + thin top bar with a single DeepBook-style floating top nav: brand, nav links, market search (⌘K), Portfolio/Cash pill, Deposit button, profile menu.

**Architecture:** New `TopNav` client component (brand + links + mobile sheet) composes a new `MarketSearch` (client-side filter over `useLiveMarkets`, navigates to `/?m=<oracleId>`) and the restyled existing `AccountBar`. `layout.tsx` drops the entire sidebar shell. The Trade page reads `?m=` as the market selection seed.

**Tech Stack:** Next.js (app router, this repo's vendored version — see `web/AGENTS.md`; read `node_modules/next/dist/docs/` before using unfamiliar APIs), React Query hooks already in place, shadcn/ui (`sheet`, `button`, `skeleton`), lucide icons. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-06-12-topnav-redesign-design.md`

**Conventions:** Top-level dir is NOT a git repo — no commits. Single `pnpm web:typecheck` + `pnpm web:lint` pass at the very end only (user preference: no per-task verification). Theme tokens (`--primary` Sui azure, `positive`/`negative`) are unchanged.

---

### Task 1: `MarketSearch` component

**Files:**
- Create: `web/src/components/app-shell/market-search.tsx`

- [ ] **Step 1.1: Create the component**

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { expiryLabel } from '@/components/trade/market-card';
import { useLiveMarkets } from '@/lib/hooks';
import { formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Global market search. Client-side filter over the live markets feed;
 * selecting a market routes to the Trade page with `?m=<oracleId>`.
 */
export function MarketSearch({ className }: { className?: string }) {
  const router = useRouter();
  const markets = useLiveMarkets();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search field from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = useMemo(() => {
    if (!markets.data) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? markets.data.filter((m) => `${m.pair} ${expiryLabel(m)}`.toLowerCase().includes(q))
      : markets.data;
    return list.slice(0, 8);
  }, [markets.data, query]);

  const select = (oracleId: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    router.push(`/?m=${oracleId}`);
  };

  return (
    <div
      className={cn('relative', className)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) select(matches[0].oracleId);
          if (e.key === 'Escape') inputRef.current?.blur();
        }}
        placeholder="Search markets…"
        aria-label="Search markets"
        className="h-9 w-full rounded-full border border-white/10 bg-white/[0.05] pl-10 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/60"
      />
      <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] text-muted-foreground md:inline-block">
        ⌘K
      </kbd>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-popover p-1 shadow-2xl backdrop-blur-xl">
          {markets.isError ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Markets unavailable.</p>
          ) : !markets.data ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading markets…</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No markets match “{query}”.</p>
          ) : (
            matches.map((m) => (
              <button
                key={m.oracleId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(m.oracleId)}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left hover:bg-white/[0.06]"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{m.pair}</span>
                  <span className="text-xs text-muted-foreground">{expiryLabel(m)}</span>
                </span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-sm">{formatUsd(m.spot)}</span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      m.sessionChangePct >= 0 ? 'text-positive' : 'text-negative',
                    )}
                  >
                    {formatPct(m.sessionChangePct)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
```

---

### Task 2: Restyle `AccountBar` — Portfolio/Cash pill

**Files:**
- Modify: `web/src/components/account/account-bar.tsx`

- [ ] **Step 2.1: Replace `Readout` and the signed-in return block**

`Readout` loses its own responsive hiding (the pill handles it). Replace the whole component body below the imports (imports and the portfolio/cash computation stay exactly as they are):

```tsx
function Readout({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col items-end">
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
```

And the signed-in JSX (everything after the `cash` computation):

```tsx
  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden h-10 items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 sm:flex">
        <Readout label="Portfolio" value={portfolio} />
        <div className="h-5 w-px bg-white/10" />
        <Readout label="Cash" value={cash} />
      </div>
      <Button
        size="sm"
        className="rounded-full px-4"
        disabled={faucet.isPending}
        onClick={() => faucet.mutate()}
      >
        <Droplets className="size-4 sm:hidden" />
        <span className="hidden sm:inline">{faucet.isPending ? 'Sending…' : 'Deposit'}</span>
      </Button>
      <ProfileMenu />
    </div>
  );
```

---

### Task 3: `TopNav` component

**Files:**
- Create: `web/src/components/app-shell/top-nav.tsx`

- [ ] **Step 3.1: Create the component**

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { AccountBar } from '@/components/account/account-bar';
import { MarketSearch } from '@/components/app-shell/market-search';
import { cn } from '@/lib/utils';

const NAV_ITEMS: { title: string; href: string; badge?: string }[] = [
  { title: 'Trade', href: '/' },
  { title: 'My Bets', href: '/bets' },
  { title: 'Strike', href: '/strike' },
  { title: 'Vault', href: '/vault' },
  { title: 'Leaderboard', href: '/leaderboard' },
  { title: 'Launch', href: '/launch', badge: 'Soon' },
];

function NavLink({
  item,
  pathname,
  onNavigate,
  className,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors',
        pathname === item.href
          ? 'text-foreground'
          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        className,
      )}
    >
      {item.title}
      {item.badge ? (
        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 md:px-6">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 rounded-2xl border border-white/10 bg-background/70 px-3 backdrop-blur-2xl md:gap-4 md:px-4">
        {/* Mobile nav sheet */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 border-white/10 bg-popover">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Waves className="size-5 text-primary" /> Hunchbook
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-2">
              <MarketSearch className="mb-2" />
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={() => setSheetOpen(false)}
                  className="rounded-lg px-3"
                />
              ))}
            </div>
          </SheetContent>
        </Sheet>

        {/* Brand */}
        <Link href="/" className="flex shrink-0 items-center gap-2 pr-1 md:pr-2">
          <Waves className="size-6 text-primary" />
          <span className="text-lg font-semibold tracking-tight">Hunchbook</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        {/* Search (desktop) */}
        <MarketSearch className="ml-auto hidden max-w-md flex-1 md:block" />

        {/* Account cluster */}
        <div className="ml-auto md:ml-0">
          <AccountBar />
        </div>
      </div>
    </header>
  );
}
```

Note the double `ml-auto`: on desktop the search carries it, on mobile (search hidden) the account cluster carries it.

---

### Task 4: Swap the app shell in `layout.tsx`, delete old shell files

**Files:**
- Modify: `web/src/app/layout.tsx`
- Delete: `web/src/components/app-shell/top-bar.tsx`, `web/src/components/app-shell/app-sidebar.tsx`
- Maybe delete: `web/src/components/ui/sidebar.tsx` (Step 4.3)

- [ ] **Step 4.1: Rewrite `layout.tsx` body**

Replace the imports of `SidebarInset`/`SidebarProvider`, `AppSidebar`, `TopBar` with `TopNav`, and the body JSX:

```tsx
import { TopNav } from "@/components/app-shell/top-nav";
```

```tsx
      <body className="min-h-full">
        <Providers>
          <TooltipProvider>
            <TopNav />
            <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6">{children}</main>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </Providers>
      </body>
```

Keep the `<html>` element, fonts, metadata, and `Providers` exactly as they are. The two-layer comment about the frosted panel goes away with the `SidebarInset`.

- [ ] **Step 4.2: Delete the old shell components**

```bash
rm web/src/components/app-shell/top-bar.tsx web/src/components/app-shell/app-sidebar.tsx
```

- [ ] **Step 4.3: Delete `ui/sidebar.tsx` if now unreferenced**

```bash
grep -rn "components/ui/sidebar" web/src --include="*.tsx" --include="*.ts"
```

Expected: no hits (only the two deleted files imported it). If no hits, `rm web/src/components/ui/sidebar.tsx`. If it imports a `use-mobile` hook that nothing else uses, leave that hook alone (other shadcn components may use it; check with grep before touching).

---

### Task 5: Trade page reads `?m=`

**Files:**
- Modify: `web/src/app/page.tsx`

- [ ] **Step 5.1: Check the vendored Next.js docs for `useSearchParams` rules**

Read `web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` (file name may differ slightly — `ls` the functions dir). Confirm whether a client page using `useSearchParams` must be wrapped in `<Suspense>`. Follow what the doc says — if required, apply the wrapper exactly as below; if the vendored version says otherwise, adapt.

- [ ] **Step 5.2: Seed market selection from the URL param**

In `web/src/app/page.tsx`: rename the existing component to `TradePageInner`, add the param read, and export a Suspense-wrapped default (assuming Step 5.1 confirms the wrapper is needed):

```tsx
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
```

Inside `TradePageInner`, replace the `oracleId` block:

```tsx
  const searchParams = useSearchParams();
  const [oracleId, setOracleId] = useState<string>();
  // User's explicit pick wins; otherwise the `?m=` deep link (from the global
  // search); otherwise the nearest market not in its pre-expiry freeze window.
  const requested = oracleId ?? searchParams.get('m') ?? undefined;
  const market =
    markets.data?.find((m) => m.oracleId === requested) ??
    markets.data?.find((m) => m.expiry - Date.now() > 30_000) ??
    markets.data?.[0];
```

At the bottom:

```tsx
export default function TradePage() {
  return (
    <Suspense>
      <TradePageInner />
    </Suspense>
  );
}
```

---

### Task 6: Page headings (the old top bar carried titles)

**Files:**
- Modify: `web/src/app/bets/page.tsx`, `web/src/app/strike/page.tsx`, `web/src/app/vault/page.tsx`, `web/src/app/leaderboard/page.tsx`, `web/src/app/profile/page.tsx`

- [ ] **Step 6.1: Add an `h1` as the first child of each page's top-level container**

The heading pattern (same for all five pages):

```tsx
<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
```

Titles: `/bets` → `My Bets`, `/strike` → `Strike Studio`, `/vault` → `Liquidity Vault`, `/leaderboard` → `Leaderboard`, `/profile` → `Profile`.

Each page's outermost element is a `<div className="space-y-6">` (profile: `<div className="mx-auto max-w-2xl space-y-6">`); insert the `h1` as its first child. `bets/page.tsx` has an early signed-out `return` — leave that one alone. `launch/page.tsx` already has a hero `h1` — skip it. If a page already visibly titles itself (e.g., a heading inside its first card covers it), skip it and note that in the final summary.

---

### Task 7: Final verification

- [ ] **Step 7.1: Typecheck + lint (single pass, end only)**

```bash
pnpm web:typecheck && pnpm web:lint
```

Expected: both exit 0. Fix anything they surface, rerun once.

- [ ] **Step 7.2: Manual smoke test**

```bash
pnpm web:dev
```

Check: nav links route + active state; ⌘K focuses search; typing filters; selecting a market routes to `/` and the chart header select shows it; Portfolio/Cash pill renders with live values (signed in) and the bar shows only Connect signed out; mobile viewport shows hamburger sheet with working search + links; Deposit button still triggers the faucet toast.
