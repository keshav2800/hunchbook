# Active Bets Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real on-chain active + settled positions in a slim card under the Quick Bet panel.

**Architecture:** `/api/positions` route reads the manager's `Table<MarketKey, u64>` via RPC dynamic fields, joins oracle settlement state, returns decoded rows. Client hook polls it; rows price live values from the SVI surface.

**Tech Stack:** Existing stack only — no new deps.

**Spec:** `docs/superpowers/specs/2026-06-10-active-bets-card-design.md`

**Notes:** No commits (not a git repo), no build/typecheck runs (user preference). Verified: `direction` 0=UP/1=DOWN; positions table field path `content.fields.positions.fields.id.id`; quantity raw 1e6 = one $1-payout unit.

---

### Task 1: Position type + `/api/positions` route

**Files:**
- Modify: `web/src/lib/types.ts` (append `BetPosition`)
- Create: `web/src/app/api/positions/route.ts`

Append to types.ts:

```ts
export interface BetPosition {
  oracleId: string;
  expiry: number; // unix ms
  strikeUsd: number;
  direction: Direction;
  units: number; // $1-payout units (quantity / 1e6)
  status: 'active' | 'settled';
  won: boolean | null; // null while active
  settlementUsd: number | null;
}
```

Route: GET `?manager=0x…` → manager object → positions table id → paginated `getDynamicFields` (cap 200) → `multiGetObjects` showContent → decode `Field<MarketKey, u64>` → join `listOracles()` → `BetPosition[]` sorted active-first then by expiry. 502 with `{error}` on RPC/indexer failure. (Full code in execution.)

### Task 2: `usePositions` hook + `ActiveBetsCard` component

**Files:**
- Create: `web/src/lib/use-positions.ts` — `useManagerId()` (query on `/api/manager`, enabled when signed in) + `usePositions()` (10s refetch, enabled when managerId present)
- Create: `web/src/components/trade/active-bets-card.tsx` — card per spec: hidden when empty/signed out; "Active Bets · N" header; active rows (▲/▼, "BTC > $X", small `Countdown`, live value from `binaryUpProbability × units`), divider, settled rows (trophy/+payout for wins, muted for losses); `max-h-72 overflow-y-auto`
- Modify: `web/src/lib/use-place-bet.ts` — invalidate `['positions']` on bet success
- Modify: `web/src/app/page.tsx` — render `<ActiveBetsCard markets={markets.data} />` under `<QuickBetPanel>` in the right column (wrap both in a `space-y-6` div)

### Task 3: Hand-off

User verifies in browser after placing first successful bet.
