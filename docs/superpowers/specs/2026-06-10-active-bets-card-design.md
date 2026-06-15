# Active Bets Card — Design

**Date:** 2026-06-10
**Status:** Approved (user, 2026-06-10; settled/winning bets included at user request)
**Scope:** Real on-chain positions display on the Trade page. No cash-out action yet (next task).

## Placement & look

Slim card directly under the Quick Bet panel (existing 360px right column). Hidden entirely when signed out, no manager, or zero positions. Header "Active Bets · N". Max ~5 visible rows, scroll past that. Not a popup — zero-click visibility, no added chrome.

## Rows

One compact row per position, two groups separated by a subtle divider:

- **Active** (oracle still active): colored ▲/▼ + "BTC > $61,400" + small `Countdown` chip + live current value `~p × units dUSDC` (re-priced client-side from the SVI surface each market poll).
- **Settled** (oracle settled, position unredeemed): won → green trophy + "+units dUSDC" (cash-or-nothing payout = quantity units × $1); lost → muted row with strikethrough-style de-emphasis. Won/lost determined by `direction` vs `settlement_price` vs `strike`.

## Data path

`GET /api/positions?manager=0x…` (gateway pattern):
1. `getObject(manager, showContent)` → positions `Table` object id (field layout verified in `predict_manager.move`: `positions: Table<MarketKey, u64>`).
2. `getDynamicFields` (paginate, cap 200) → `multiGetObjects` with content → each `Field<MarketKey, u64>`: name fields `{ oracle_id, expiry, strike, direction }` (direction: 0=UP, 1=DOWN, verified in `market_key.move`), value = quantity (raw, 1e6 = one $1-payout unit).
3. Join `listOracles()` by oracle_id for status + settlement_price.
4. Return decoded rows (strike/settlement in USD floats, quantity in units).

Client: `usePositions()` — TanStack Query keyed on managerId, 10s refetch, invalidated after placing a bet. Manager id fetched via existing `/api/manager`.

## Out of scope

Cash-out/claim action, redeemed-position history, range positions.
