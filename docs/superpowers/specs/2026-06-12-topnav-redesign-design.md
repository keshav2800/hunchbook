# Top Nav Redesign — DeepBook-style App Shell

**Date:** 2026-06-12
**Status:** Approved (user, this session)

## Goal

Replace the sidebar + thin top bar shell with a single DeepBook/Polymarket-style
floating top navigation bar: brand, nav links, market search, Portfolio/Cash
pill, Deposit button, profile menu. Match the DeepBook site aesthetic (dark
floating rounded bar, quiet text links, solid primary CTA) using the existing
Hunchbook theme tokens.

## Decisions

- **Sidebar is removed entirely.** Top nav is the only navigation surface
  (user-confirmed). `app-sidebar.tsx` and `top-bar.tsx` are deleted.
- **Theme tokens unchanged.** Sui azure `--primary` stands in for DeepBook
  blue. No retheme.
- **Search drives the Trade page via URL param** `/?m=<oracleId>`.

## Layout

`web/src/app/layout.tsx` loses `SidebarProvider`/`AppSidebar`/`SidebarInset`
and becomes:

```
<body>                                  — world gradient (unchanged)
  <TopNav />                            — sticky, z-50
  <main class="mx-auto w-full max-w-[1440px] px-4 md:px-6 py-6">
    {children}
  </main>
</body>
```

The frosted "dashboard panel" wrapper goes away; the nav bar itself is the
frosted element (border-white/10, bg translucent, backdrop-blur), floating on
the gradient world like DeepBook's site nav.

## TopNav component (`components/app-shell/top-nav.tsx`)

One `h-16` sticky bar, inner container `max-w-[1440px] mx-auto px-4 md:px-6`,
`flex items-center gap-6`.

1. **Brand** — `Waves` icon in `text-primary` + "Hunchbook" wordmark
   (`text-lg font-semibold tracking-tight`), links to `/`.
2. **Nav links** (desktop `hidden md:flex`): Trade `/`, My Bets `/bets`,
   Strike `/strike`, Vault `/vault`, Leaderboard `/leaderboard`, Launch
   `/launch` with a `Soon` badge. Style: `text-sm font-medium
   text-muted-foreground`, `rounded-full px-3 py-2`, hover `bg-white/5
   text-foreground`, active route `text-foreground`.
3. **MarketSearch** (`components/app-shell/market-search.tsx`) — flexes to
   fill (`flex-1 max-w-md`), rounded-full glass input with `Search` icon and
   ⌘K hint. Uses `useLiveMarkets()`; typing filters by pair string. Results
   panel (cmdk `Command` in an anchored popover) rows show pair, expiry label,
   spot price, session change (positive/negative color). Select →
   `router.push('/?m=<oracleId>')` and close. ⌘K / Ctrl+K focuses search.
4. **AccountBar** (restyled, same data wiring):
   - **Portfolio/Cash pill** — single `rounded-full border border-white/10
     bg-white/[0.04]` pill, two readouts separated by a vertical hairline.
     Labels `text-[11px] text-muted-foreground`, values `text-sm font-semibold
     tabular-nums`. Skeletons while loading, `—` on error (existing logic).
   - **Deposit** — solid primary `rounded-full` button (testnet faucet
     mutation, unchanged).
   - **ProfileMenu** avatar, unchanged.
   - Signed out → `ConnectButton` only.

### Mobile (`< md`)

- Hamburger (left of brand) opens a `Sheet` with nav links + Portfolio/Cash
  readouts.
- Search collapses to an icon button opening the same command panel as a
  dialog.
- Deposit becomes an icon button (`Droplets`), profile avatar stays.

## Trade page change

`app/page.tsx`: selected market becomes
`oracleId ?? useSearchParams().get('m') ?? <existing fallbacks>`. Local
`setOracleId` (header select, market cards) still works and takes precedence
after user interaction.

## Page headings

The old top bar rendered per-route titles. Routes whose pages lack a visible
heading get a small `h1` (`text-lg font-semibold tracking-tight`) at the top
of their content: My Bets, Strike Studio, Vault, Leaderboard, Launch, Profile
(verify each during implementation; skip pages that already render one).

## Not in scope

- No retheme, no new colors or fonts.
- No server-side search; filtering is client-side over `useLiveMarkets()`.
- No change to bet placement, vault, profile, or data hooks.

## Error handling

- Markets loading: search shows "Loading markets…" empty state.
- Markets error: search shows "Markets unavailable" empty state.
- Pill readouts keep existing skeleton/`—` behavior.

## Testing / verification

- `pnpm web:typecheck` once at the end (user preference: no repeated
  typechecks).
- Manual: dev server — nav routes highlight correctly, ⌘K search filters and
  navigates, pill values match old AccountBar, mobile sheet works, signed-out
  state shows Connect only.
