# Account Bar, Statistics Dialog & My Bets Page — Design

**Date:** 2026-06-11
**Status:** Approved (user confirmed trigger, content, page structure, and top-bar mapping; directed to proceed to implementation)

## Goal

Surface the bet-history data (`/api/history`, built 2026-06-10) in three places, styled after the
Stake statistics modal and the Polymarket account bar the user provided as references:

1. **Top bar** — Polymarket-style: `Portfolio $X · Cash $X · [Deposit] · [avatar]`.
2. **Statistics dialog** — Stake-style popup opened from the avatar dropdown.
3. **My Bets page** — `/bets`, sidebar nav item: stats strip + outcome tabs + history table.

## Decisions locked with the user

- Stats popup opens from the **account (avatar) dropdown** only.
- **No usernames, no VIP tiers, no currency selectors.** Identity = short address + first-bet date.
  A win-rate bar sits where Stake's VIP bar was.
- My Bets = **tabs (All / Open / Won / Lost) + compact stats strip** above the table.
- Top-bar mapping confirmed: Portfolio = live value of active bets (same SVI win-probability ×
  units math as cash-out estimates) + manager internal balance; Cash = wallet dUSDC;
  Deposit = existing testnet faucet; avatar dropdown = address/copy, Statistics, Leaderboard, Sign out.

## Production review findings (incorporated)

1. **Cashed-out bets misreported (correctness bug).** `parse-bets.ts` only parses `place_bet`
   txs, so a bet cashed out early would later render as won/lost at settlement with a payout that
   was never received. Fix: also parse `router::cashout` txs (they carry the same `market_key`
   move-call pattern); aggregate received dUSDC per market key; mark matching bets
   `outcome: 'cashed_out'` with `payoutUsd` = actual received (pro-rated across multiple bets on
   the same key by units). Cash-outs are excluded from win/loss counts, included in wagered.
2. **History endpoint is expensive** (walks ≤200 txs + per-tx decode). Add a module-level TTL
   cache (30 s, keyed by owner) in the route — fine for a single Next instance — plus
   `Cache-Control: private, max-age=30`. Client hook uses `staleTime: 30_000`, no interval
   polling (history only changes on user action; mutations invalidate it explicitly).
3. **Truncation must be visible.** If the 200-tx cap is hit, route returns `truncated: true` and
   the table footer says "Showing bets from your last 200 transactions."
4. **One source of truth for live value.** Extract `liveValue()` + `describeBet()` from
   `active-bets-card.tsx` into `lib/bet-math.ts`; Portfolio and the card both import it so the
   two numbers can never drift.
5. **Payout semantics:** won → `+units` (each unit pays $1), lost → `0`, open → `—`,
   cashed_out → `+payoutUsd` (actual). All before the 1% router exit fee, matching existing toasts.
6. **Win rate** = wins / (wins + losses), settled bets only. Hidden when no settled bets.
7. **Explorer links** use the existing Suiscan testnet URL; constant moves to `lib/bet-math.ts`
   (single definition, imported by hooks and table).
8. **States:** skeletons for loading, warning banner (trade-page pattern) for errors, per-tab
   empty copy, signed-out `/bets` shows a sign-in prompt card. Top bar shows nothing
   account-related when signed out (just the Google sign-in button, unchanged).

## Architecture (Approach A — shared client hook, no new deps)

```
/api/history?owner=0x…  ──►  useBetHistory(owner)  ──►  StatsDialog (via ProfileMenu)
     │ 30s TTL cache                 │                   StatsStrip + BetHistoryTable (/bets)
     │ + cashout parsing             └── query key ['bet-history', owner]
     │
usePositions / useLiveMarkets / useDusdcBalance (existing) ──► TopBar Portfolio & Cash
useFaucet (existing) ──► TopBar Deposit button
```

### New files

| File | Purpose |
|---|---|
| `web/src/lib/bet-math.ts` | `liveValue()`, `describeBet()`, `EXPLORER_TX` const (extracted, shared) |
| `web/src/lib/use-bet-history.ts` | React Query hook for `/api/history`; exports `BetHistoryResponse` |
| `web/src/components/account/address-avatar.tsx` | Deterministic gradient avatar from address hash |
| `web/src/components/account/profile-menu.tsx` | Avatar dropdown: address+copy, Statistics, Leaderboard, Sign out |
| `web/src/components/account/stats-dialog.tsx` | Stake-style dialog: identity, win-rate bar, 2×2 stat grid |
| `web/src/components/account/account-bar.tsx` | Portfolio/Cash readouts + Deposit button + ProfileMenu |
| `web/src/components/bets/stats-strip.tsx` | Compact 4-stat strip for `/bets` (shares cell rendering with dialog grid) |
| `web/src/components/bets/bet-history-table.tsx` | Tabbed table: Date · Bet · Stake · Payout · Outcome · Tx |
| `web/src/app/bets/page.tsx` | My Bets page composition |

### Modified files

| File | Change |
|---|---|
| `web/src/lib/server/parse-bets.ts` | Parse `cashout` txs → `CashoutTxRecord[]`; return both record kinds |
| `web/src/app/api/history/route.ts` | Join cashouts, `cashed_out` outcome, `payoutUsd`, stats excl. cash-outs from W/L, TTL cache, `truncated` flag, `firstBetMs` |
| `web/src/lib/types.ts` | `BetHistoryEntry.outcome` += `'cashed_out'`; add `payoutUsd`; `BetStats` += `cashedOut`; response type gains `truncated`, `firstBetMs` |
| `web/src/lib/use-place-bet.ts` | Invalidate `['bet-history']` in placeBet/cashout/withdraw `onSuccess` |
| `web/src/components/trade/active-bets-card.tsx` | Import `liveValue`/`describeBet` from `lib/bet-math` (no behavior change) |
| `web/src/components/app-shell/top-bar.tsx` | Render `AccountBar` (signed in) / `ConnectButton` (signed out); add `/bets` title |
| `web/src/components/auth/connect-button.tsx` | Slims to signed-out button only (dropdown moves to ProfileMenu) |
| `web/src/components/app-shell/app-sidebar.tsx` | Add `My Bets` nav item (`History` icon, `/bets`) |

### Component details

**AccountBar** (signed in): two labeled readouts in Polymarket style — small muted label over
tabular-nums value — `Portfolio` (sum of `liveValue()` over active positions + settled-won claimables
at face value + `managerBalanceUsd`) and `Cash` (wallet dUSDC); a primary `Deposit` button
(`useFaucet`, spinner while pending); `ProfileMenu`. Values render `—` on query error, skeleton
pulse while loading. Hidden below `sm:` except avatar + Deposit (mobile keeps top bar tight).

**ProfileMenu**: `AddressAvatar` (size-8, two-stop gradient derived from address bytes) as
trigger; dropdown: mono short address (click = copy + toast), separator, `Statistics`
(BarChart3 icon) opens `StatsDialog`, `Leaderboard` (Trophy icon) links `/leaderboard`,
separator, `Sign out`. Dialog state owned by ProfileMenu (`open` boolean), Dialog rendered as
sibling of the DropdownMenu so menu close doesn't unmount it.

**StatsDialog**: header `Statistics` with chart icon; identity row (avatar, mono address,
"First bet <date from firstBetMs>" or "No bets yet"); win-rate row (`Progress`-style bar built
with existing div+rounded styling — no new dep — caption "Win rate 57% · 12W / 9L"), hidden
until ≥1 settled bet; 2×2 grid of bordered cells: Total Bets, Wins, Losses, Wagered (dUSDC).
Skeletons while loading; error → muted error line with retry button.

**/bets page**: `Tabs` (All / Open / Won / Lost) defaulting to All; `StatsStrip` above
(4 cells, same numbers as dialog); table columns Date (MMM d, HH:mm) · Bet (▲/▼ + "BTC > $X") ·
Stake · Payout (green `+x` / muted `0` / `—` / blue `+x` cashed out) · Outcome `Badge`
(won=positive, lost=muted, open=outline, cashed out=secondary) · Tx (short digest → Suiscan,
external-link icon). Tab filtering is client-side. Cashed-out rows appear under All only (not
Won/Lost/Open). Sorted newest first. Footer note when `truncated`.

### Data flow & errors

- `useBetHistory`: `['bet-history', address]`, enabled iff signed in, `staleTime` 30 s,
  `retry: 1`. Mutations in `use-place-bet.ts` invalidate it.
- Route failures → 502 `{error}` (existing pattern); UI: banner on `/bets`, inline error in dialog,
  `—` in top bar.
- No live SVI dependency on `/bets` (payouts are face values, not marks) — page works even if
  markets API is down.

### Testing

- `parse-bets` cashout matching is the only intricate logic; verified by typecheck + manual
  testnet walkthrough (place → cash out → check My Bets shows cashed_out, stats exclude it from W/L).
- Per user preference: single typecheck/lint pass at the end, no per-task builds; user verifies
  in browser (faucet → bet → cashout → dialog + /bets).

### Out of scope

- Leaderboard/streak real data (separate feature; mock hooks untouched).
- Web push notifications, CSV export ("Request statistics" button cut).
- Pagination beyond the 200-tx window.
