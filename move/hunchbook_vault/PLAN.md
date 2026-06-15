# Hunchbook Vault — Architecture Plan

A hedged PLP-yield vault on DeepBook Predict. This document fixes the design
**before** any code is written so that the implementation has no dead ends.

## What it is

One shared `Vault<Quote>` object. LPs deposit `Coin<Quote>`, receive
`Coin<PF_SHARE>`. Operator (holds `AdminCap`) deploys the vault's idle quote
balance into a `PredictManager` and uses it to (a) supply PLP for yield,
(b) mint OTM-binary wings as tail-event insurance. Hedge sizing is
parameterized off pool utilization via a step function — adaptive, not fixed.

## Why two layers

`PredictManager.deposit` / `withdraw` assert `ctx.sender() == self.owner`.
We cannot make a shared vault object the "owner" of a manager directly; an
address must own it. So the vault is split into:

1. **LP-facing surface** (`vault::deposit`, `vault::withdraw`, `vault::nav`)
   — anyone can call, no `AdminCap` needed. Operates on the vault's own
   `Balance<Quote>` and the share-token `TreasuryCap`.

2. **Operator-facing surface** (everything that touches the manager) —
   gated by `&AdminCap` and the operator's signature, since the operator's
   address owns the underlying `PredictManager`.

LP-facing flows compute NAV from `vault.idle_balance + plp_value +
open_positions_value`. The first is local; the latter two come from reading
the manager passed in by reference.

## Modules (3 source files, 1 test file)

```
move/hunchbook_vault/
├── Move.toml
├── PLAN.md              this file
└── sources/
    ├── pf_share.move    OTW + TreasuryCap<PF_SHARE>; init() creates token
    ├── hedge_policy.move  PURE: utilization -> annual hedge pct; deterministic, testable in isolation
    └── vault.move       Vault state, deposit/withdraw, NAV, operator entry points
└── tests/
    └── vault_tests.move
```

**`hedge_policy.move`** is a pure-function module with **no objects, no
resources, no state**. The step function lives here so it's trivially
testable and reusable from the bot/frontend (read-only). Keeping the policy
separate from execution is a Jane-Street-style separation of concerns —
pricing/policy logic should never accidentally hold state.

## Core types

### `pf_share.move`

```move
public struct PF_SHARE has drop; // One-time witness for the share Coin
```

`init` runs once at publish:
- Creates `Currency<PF_SHARE>` via `coin_registry::new_currency_with_otw`
- Transfers `TreasuryCap<PF_SHARE>` to the publisher so they can pass it into
  `vault::init_for` (a one-shot move into the Vault on creation).

### `vault.move`

```move
public struct Vault<phantom Quote> has key {
    id: UID,

    // === LP-facing accounting ===
    /// Idle quote (LP deposits not yet deployed to manager).
    idle: Balance<Quote>,
    /// Quote that has been forwarded into the manager. Tracked locally so
    /// NAV can be computed without round-tripping the manager when idle is
    /// the only thing changing.
    deployed_principal: u64,
    /// Share token supply controller.
    treasury: TreasuryCap<PF_SHARE>,

    // === Operator policy ===
    /// ID of the PredictManager this vault routes through. Asserted on every
    /// operator entry point so a stray manager can't be substituted.
    manager_id: ID,
    /// Hard cap on NAV — gates new deposits when reached.
    capacity_raw: u64,
    /// If true, deposits & operator actions are disabled. Withdrawals stay
    /// open so LPs can always exit.
    paused: bool,

    // === Fee accrual ===
    perf_fee_bps: u16,            // e.g. 2000 = 20%
    mgmt_fee_bps_yr: u16,         // e.g. 100 = 1%/year
    accrued_perf: Balance<Quote>,
    accrued_mgmt: Balance<Quote>,
    /// Last time mgmt fee was accrued (ms). Used to compute pro-rata accrual.
    last_mgmt_ms: u64,
    /// Watermark for performance fee — only NAV-per-share above this level
    /// triggers perf fee accrual on the next mark.
    perf_watermark_per_share_q64: u128,

    // === Hedge config (echoes hedge_policy::HedgeConfig) ===
    hedge_sigma_bps: u16,         // OTM distance in bps; default 200 (2%)
    hedge_vol_bps: u16,           // assumed annual vol; default 8000 (80%)
}

public struct AdminCap has key, store {
    id: UID,
    vault_id: ID,                 // checked on every cap-gated entry
}
```

### `hedge_policy.move`

Pure functions. No structs except a return value:

```move
public fun annual_hedge_bps(utilization_bps: u64): u16
```

Step function:
- `[0, 500)` (util < 5%)  → 100  bps (1%)
- `[500, 2000)` (5–20%)   → 300  bps (3%)
- `[2000, 5000)` (20–50%) → 800  bps (8%)
- `[5000, +∞)` (≥50%)     → 1500 bps (15%)

Why bps in/out: keeps everything in integer math; matches the bps convention
the rest of DeepBook uses.

## Public surface (minimal, no redundancy)

### LP-facing (no AdminCap)

```move
public fun deposit<Quote>(
    vault: &mut Vault<Quote>,
    manager: &PredictManager,  // read-only — NAV computation
    payment: Coin<Quote>,
    ctx: &mut TxContext,
): Coin<PF_SHARE>;

public fun withdraw<Quote>(
    vault: &mut Vault<Quote>,
    manager: &PredictManager,  // read-only
    shares: Coin<PF_SHARE>,
    ctx: &mut TxContext,
): Coin<Quote>;

public fun nav<Quote>(vault: &Vault<Quote>, manager: &PredictManager): u64;
public fun share_price_q64<Quote>(vault: &Vault<Quote>, manager: &PredictManager): u128;
```

### Operator-facing (require AdminCap + matching manager owner = signer)

```move
public fun deploy_idle<Quote>(
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    manager: &mut PredictManager,
    amount: u64,
    ctx: &mut TxContext,
);

public fun reclaim_idle<Quote>(  // pull capital out of manager → vault.idle
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    manager: &mut PredictManager,
    amount: u64,
    ctx: &mut TxContext,
);

public fun mint_hedge_wing<Quote>(
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
);

public fun redeem_hedge_wing<Quote>(/* mirror of mint_hedge_wing */);

public fun pause<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap);
public fun unpause<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap);
public fun set_capacity<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap, new_cap: u64);
public fun set_hedge_params<Quote>(
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    sigma_bps: u16,
    vol_bps: u16,
);
public fun accrue_mgmt_fee<Quote>(
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    manager: &PredictManager,
    clock: &Clock,
);
public fun claim_fees<Quote>(
    vault: &mut Vault<Quote>,
    cap: &AdminCap,
    to: address,
    ctx: &mut TxContext,
);
```

### Construction

```move
/// One-time. Caller passes a freshly created manager_id (the same call sequence
/// that creates it transfers it to the operator). Caller becomes admin via the
/// returned AdminCap; the vault is share_object'd.
public fun new<Quote>(
    treasury: TreasuryCap<PF_SHARE>,
    manager_id: ID,
    capacity_raw: u64,
    perf_fee_bps: u16,
    mgmt_fee_bps_yr: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): AdminCap;
```

## Events (centralized at top of `vault.move`)

```move
public struct VaultCreated   has copy, drop, store { vault_id: ID, manager_id: ID }
public struct Deposited      has copy, drop, store { vault_id: ID, lp: address, quote_in: u64, shares_out: u64, share_price_q64: u128 }
public struct Withdrawn      has copy, drop, store { vault_id: ID, lp: address, shares_in: u64, quote_out: u64, share_price_q64: u128 }
public struct CapacityChanged has copy, drop, store { vault_id: ID, new_cap: u64 }
public struct Paused         has copy, drop, store { vault_id: ID }
public struct Unpaused       has copy, drop, store { vault_id: ID }
public struct HedgeMinted    has copy, drop, store { vault_id: ID, oracle_id: ID, strike: u64, is_up: bool, quantity: u64, cost: u64 }
public struct HedgeRedeemed  has copy, drop, store { vault_id: ID, oracle_id: ID, strike: u64, is_up: bool, quantity: u64, payout: u64 }
public struct FeesAccrued    has copy, drop, store { vault_id: ID, mgmt_delta: u64, perf_delta: u64 }
public struct FeesClaimed    has copy, drop, store { vault_id: ID, mgmt: u64, perf: u64, to: address }
```

## Error codes

```move
const ENotAdmin: u64 = 0;
const EWrongManager: u64 = 1;
const EPaused: u64 = 2;
const EZeroAmount: u64 = 3;
const ECapacityExceeded: u64 = 4;
const EZeroNav: u64 = 5;
const EInsufficientIdle: u64 = 6;
const EInsufficientShares: u64 = 7;
const EInvalidFeeBps: u64 = 8;
const EInvalidHedgeParams: u64 = 9;
```

## NAV math (precision-aware)

Share price is held internally as a Q64.64 fixed-point (`u128`) so deposits
and withdrawals are exact under integer arithmetic:

```
share_price_q64 = (nav << 64) / total_supply       // when total_supply > 0
nav             = (share_price_q64 * total_supply) >> 64
shares_out      = (quote_in << 64) / share_price_q64
quote_out       = (share_price_q64 * shares_in) >> 64
```

Genesis bootstrap: when `total_supply == 0`, mint shares 1:1 with quote and
set `share_price_q64 = (1 << 64)`. This pegs initial price to exactly 1.

Performance fee is accrued only when current `share_price_q64` exceeds the
stored watermark. Mgmt fee accrues continuously as
`(nav * mgmt_fee_bps_yr * elapsed_ms) / (BPS_DENOM * MS_PER_YEAR)`.

## Invariants the tests must prove

1. `total_supply == 0` ⇔ `idle.value() + deployed_principal == 0` (no shares,
   no NAV; no NAV, no shares).
2. After every `deposit` then `withdraw` by the same LP, NAV per share is
   unchanged (no value transfer to other LPs in absence of intervening PnL).
3. Two LPs depositing the same amount at the same NAV receive the same
   share count.
4. `withdraw` of all shares an LP holds returns at least `(deposit_amount
   * (1 - mgmt_fee_pct_for_period))` minus rounding dust (≤ 1 raw unit).
5. `pause` rejects future deposits but never blocks withdrawals.
6. A non-admin signer cannot call any operator function — every gated entry
   aborts with `ENotAdmin`.
7. Operator cannot reclaim more than `deployed_principal`.
8. `hedge_policy::annual_hedge_bps` is monotone non-decreasing in
   utilization and bounded in `[100, 1500]`.

## Out of scope (explicit)

- **No automatic hedge execution inside the contract.** The contract exposes
  `mint_hedge_wing` / `redeem_hedge_wing`; the keeper service (off-chain)
  calls them at each new expiry with sizing computed via `hedge_policy`. This
  matches DeepBook's own pattern (their protocol exposes primitives; off-chain
  keepers orchestrate).
- **No range bets.** MVP uses binary hedges only. Range bets are a V2
  optimization since they cost less premium for equivalent coverage but
  introduce double-strike pricing logic.
- **No dynamic hedge `_inside_ the contract.`** Hedge sizing is computed
  off-chain by the keeper using `hedge_policy::annual_hedge_bps`, then the
  keeper picks the appropriate `quantity` parameter when calling
  `mint_hedge_wing`. Centralizing the policy as a *callable pure function*
  means the bot/frontend/keeper all use the same rules without duplication.
- **No auto-roll on settlement.** Keeper handles that off-chain too.
- **No multi-asset support.** Vault is parameterized on `Quote` (a phantom)
  so a future mainnet deploy can ship multiple instances; the MVP is dUSDC.

## Resolved

- **PLP redeem/supply integration** (2026-06-11): `supply_idle_to_plp` and
  `redeem_plp_to_idle` are live in `vault.move`, calling the deployed
  `predict::supply` / `predict::withdraw` directly. The vault holds
  `Balance<PLP>` and values it at an operator **mark price**
  (`plp_mark_q64`, Q64.64): auto-refreshed from execution prices on every
  supply/redeem (unbounded — ground truth), and keeper-postable between
  trades via `set_plp_mark` (±20% drift bound per update, `EMarkDrift`).
  Mark-based valuation is required because the official testnet predict
  package does not expose a PLP price reader (`plp_value_of` exists only in
  newer source, verified absent on-chain 2026-06-11). When Mysten redeploys,
  swap the mark for the direct reader. Trust note for audit: keeper can
  misprice NAV within the drift bound per update.
  See `docs/superpowers/plans/2026-06-11-plp-supply-mark.md`.

## Open questions deferred

- **Performance-fee crystallization frequency.** MVP: at `claim_fees` time;
  could be on every NAV mark in V2.
- **Withdraw queue / cooldown.** MVP: instant withdrawals (relies on
  vault.idle being sufficient). V2: queue when idle insufficient.
