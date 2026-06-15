# PLP Supply Integration (Mark-Based Valuation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** `2026-06-05-plp-supply-integration.md`. That plan's Task 1 (add public PLP
readers to upstream `predict.move`) is **undeployable**: verified 2026-06-11 via
`sui_getNormalizedMoveFunction` that the official testnet package
`0xf5ea…5138` does NOT expose `plp_value_of`/`plp_total_supply` (the vendored source on the
`predict-testnet-4-16` branch has them at predict.move:702-709, but the deployed build predates
them, and `published-at` confirms no upgrade). The vault must interop with the official
deployment (official markets, Mysten indexer, real bettor flow), so on-chain PLP price reads
are unavailable until Mysten redeploys.

**Goal:** Wire the vault to supply idle quote into the official PLP pool and redeem it back,
with NAV valuing PLP holdings via an operator-posted **mark price** (Q64 quote-per-PLP-share),
auto-refreshed from actual execution prices on every supply/redeem.

**Architecture:** Vault gains `plp_mark_q64`/`plp_mark_ms` state. `supply_idle_to_plp` and
`redeem_plp_to_idle` call the deployed `predict::supply`/`predict::withdraw` (both verified
present on-chain) and update the mark from the trade's own execution price (ground truth, no
drift bound). Between trades the keeper computes `pool_value / plp_supply` off-chain from
Predict object state and posts it via `set_plp_mark`, which enforces a ±20% per-update drift
bound. `nav` = idle + deployed_principal + plp_balance×mark − fees; its signature is
**unchanged** (no `&Predict` param), so `deposit`/`withdraw`/`accrue_fees`/callers don't churn.
When Mysten ships the package with `plp_value_of`, the mark becomes a fallback (one-line swap).

**Tech Stack:** Sui Move 2024.beta, `sui move test --gas-limit 100000000000` (CLI no longer
accepts `--skip-fetch-latest-git-deps`), `bunx prettier-move`.

**Conventions:** `move/hunchbook_vault` is NOT in a git repo — no commits. Per user preference,
the full test suite is run after implementation is complete (baseline today: 31/31 pass), not
after every step. Error consts `EPascalCase`; events past tense; operator fns take `&AdminCap`
second; `&Clock` and `&mut TxContext` last.

**Trust model (documented, accepted for testnet):** the mark is operator-posted. A malicious
or buggy keeper can misprice NAV within ±20% per update; execution-derived marks bound the lie
to one keeper interval. Flagged for the audit; mainnet should use the upstream reader.

---

## Pre-flight (verified 2026-06-11 against current code)

- `vault.move:44` — `plp_balance: Balance<PLP>` field, zero-init (`:171`), getter (`:219`)
  **already exist** (old plan's Task 2 is done).
- `vault.move:205-210` — `nav(vault, &PredictManager)` counts idle + deployed_principal − fees.
- `vault.move:594-598` — `nav_unchecked` mirrors it; both need the plp term.
- `predict.move:437` `supply<Quote>(…): Coin<PLP>` and `:474` `withdraw<Quote>(…): Coin<Quote>`
  exist in the **deployed** package (verified via `sui_getNormalizedMoveModule`).
- `predict::supply` aborts on zero shares minted (`EZeroSharesMinted`) → `plp_received > 0`
  guaranteed; `predict::withdraw` aborts on zero amount → `quote_received > 0` guaranteed.
  Division by these values is safe.
- Errors 0-10 taken (`vault.move:27-37`); next free codes are 11+.
- Tests: `vault_tests.move` uses `setup()` → `(Clock, AdminCap)`, `QUOTE_1K = 1_000_000_000`,
  `deposit_unchecked`/`withdraw_unchecked`, `std::unit_test::{assert_eq, destroy}`.
  `coin::mint_for_testing<PLP>` works (PLP is a registered currency).
- Baseline: `sui move test --gas-limit 100000000000` → 31 passed.

## File Structure

- Modify: `move/hunchbook_vault/sources/vault.move` — state, errors, events, views, 3 operator fns,
  nav/nav_unchecked update, test-only variants.
- Modify: `move/hunchbook_vault/tests/vault_tests.move` — ~10 new tests.
- Modify: `move/hunchbook_vault/PLAN.md` — flip the open question to Resolved.
- **No changes** to `deepbookv3-src` (upstream untouched), `pf_share.move`, `hedge_policy.move`.

---

### Task 1: State, constants, errors, events

**Files:** Modify `move/hunchbook_vault/sources/vault.move`

- [ ] **Step 1.1:** Add constant under `Q64` (line 25):

```move
    /// Max relative change a keeper-posted mark may apply per update (20%).
    /// Execution-derived marks (from supply/redeem) bypass this bound — they
    /// are ground truth observed from the protocol itself.
    const MAX_MARK_DRIFT_BPS: u128 = 2_000;
```

- [ ] **Step 1.2:** Add error codes after `EInvalidWatermark` (line 37):

```move
    const EInsufficientPlp: u64 = 11;
    const EZeroMark: u64 = 12;
    const EMarkDrift: u64 = 13;
```

- [ ] **Step 1.3:** Add fields to `Vault` after `plp_balance` (line 44):

```move
        /// Quote value of one PLP share, Q64.64 fixed point. 0 = never set.
        /// Updated (a) from execution prices on every supply/redeem, and
        /// (b) by the keeper via `set_plp_mark` between trades.
        plp_mark_q64: u128,
        /// Timestamp (ms) of the last mark update. UI/keeper staleness signal;
        /// NAV does not hard-gate on it (a dead keeper must not brick withdrawals).
        plp_mark_ms: u64,
```

Initialize in `new` after `plp_balance: balance::zero(),` (line 171):

```move
            plp_mark_q64: 0,
            plp_mark_ms: 0,
```

- [ ] **Step 1.4:** Add events after `HedgeParamsChanged` (line 139):

```move
    public struct PlpSupplied has copy, drop, store {
        vault_id: ID,
        quote_in: u64,
        plp_received: u64,
        mark_q64: u128,
    }

    public struct PlpRedeemed has copy, drop, store {
        vault_id: ID,
        plp_burned: u64,
        quote_received: u64,
        mark_q64: u128,
    }

    public struct PlpMarked has copy, drop, store {
        vault_id: ID,
        mark_q64: u128,
        timestamp_ms: u64,
    }
```

### Task 2: Views + NAV includes PLP value

**Files:** Modify `move/hunchbook_vault/sources/vault.move`

- [ ] **Step 2.1:** Private helper next to `compute_quote_out` (line 564):

```move
    /// Quote value of the vault's PLP holdings at the current mark.
    /// A zero mark values PLP at zero — `supply_idle_to_plp` always sets the
    /// mark from its execution price, so a held-but-unmarked balance can only
    /// occur if state was constructed by hand in tests.
    fun plp_value_at_mark<Quote>(vault: &Vault<Quote>): u64 {
        ((vault.plp_balance.value() as u128) * vault.plp_mark_q64 / Q64) as u64
    }
```

- [ ] **Step 2.2:** Public views next to `plp_balance` getter (line 219):

```move
    public fun plp_value<Quote>(vault: &Vault<Quote>): u64 { plp_value_at_mark(vault) }

    public fun plp_mark_q64<Quote>(vault: &Vault<Quote>): u128 { vault.plp_mark_q64 }

    public fun plp_mark_ms<Quote>(vault: &Vault<Quote>): u64 { vault.plp_mark_ms }
```

- [ ] **Step 2.3:** Update `nav` body (line 205-210) — signature unchanged:

```move
    public fun nav<Quote>(vault: &Vault<Quote>, manager: &PredictManager): u64 {
        assert_manager(vault, manager);
        let gross = vault.idle.value() + vault.deployed_principal + plp_value_at_mark(vault);
        let fees = vault.accrued_perf.value() + vault.accrued_mgmt.value();
        if (fees >= gross) 0 else gross - fees
    }
```

Update the doc comment above it: add `- PLP holdings valued at the operator mark` to the
sum list and drop the "V2 (which adds PLP value lookup) doesn't break callers" sentence
(this is that V2).

- [ ] **Step 2.4:** Update `nav_unchecked` (line 594-598) identically:

```move
    #[test_only]
    public fun nav_unchecked<Quote>(vault: &Vault<Quote>): u64 {
        let gross = vault.idle.value() + vault.deployed_principal + plp_value_at_mark(vault);
        let fees = vault.accrued_perf.value() + vault.accrued_mgmt.value();
        if (fees >= gross) 0 else gross - fees
    }
```

### Task 3: `set_plp_mark` (keeper path, drift-bounded)

**Files:** Modify `move/hunchbook_vault/sources/vault.move`

- [ ] **Step 3.1:** Add after `set_hedge_params` (line 452):

```move
    /// Keeper-posted PLP mark. The keeper computes pool_value / plp_supply
    /// off-chain from the shared Predict object's state and posts it here so
    /// NAV tracks PLP appreciation between supply/redeem executions.
    ///
    /// Bounded to ±MAX_MARK_DRIFT_BPS per update relative to the current mark
    /// so a buggy or malicious keeper cannot reprice the vault in one shot.
    /// The first mark (current == 0) is unbounded — there is nothing to drift
    /// from; in practice `supply_idle_to_plp` sets it first from execution.
    public fun set_plp_mark<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        mark_q64: u128,
        clock: &Clock,
    ) {
        assert_admin(vault, cap);
        assert!(mark_q64 > 0, EZeroMark);
        let current = vault.plp_mark_q64;
        if (current > 0) {
            let diff = if (mark_q64 > current) mark_q64 - current else current - mark_q64;
            assert!(diff * (BPS_DENOM as u128) <= current * MAX_MARK_DRIFT_BPS, EMarkDrift);
        };
        record_plp_mark(vault, mark_q64, clock);
    }
```

- [ ] **Step 3.2:** Private helper next to `plp_value_at_mark`:

```move
    fun record_plp_mark<Quote>(vault: &mut Vault<Quote>, mark_q64: u128, clock: &Clock) {
        vault.plp_mark_q64 = mark_q64;
        vault.plp_mark_ms = clock.timestamp_ms();
        event::emit(PlpMarked {
            vault_id: vault.id.to_inner(),
            mark_q64,
            timestamp_ms: vault.plp_mark_ms,
        });
    }
```

### Task 4: `supply_idle_to_plp` + `redeem_plp_to_idle` (production paths)

**Files:** Modify `move/hunchbook_vault/sources/vault.move`

- [ ] **Step 4.1:** Add after `reclaim_idle` (line 356):

```move
    /// Supply quote from the vault's idle balance into the Predict PLP pool.
    /// The received `Coin<PLP>` is retained in `plp_balance`. The mark is
    /// refreshed from this trade's execution price (quote_in / plp_received) —
    /// ground truth, so no drift bound applies.
    ///
    /// PLP supply is permissionless upstream (`predict::supply` has no owner
    /// check); the AdminCap gates *this vault's* idle capital, not the pool.
    public fun supply_idle_to_plp<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        predict: &mut Predict,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        assert!(!vault.paused, EPaused);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= vault.idle.value(), EInsufficientIdle);

        let quote: Coin<Quote> = coin::take(&mut vault.idle, amount, ctx);
        let plp_coin = predict::supply<Quote>(predict, quote, clock, ctx);
        let plp_received = plp_coin.value();
        vault.plp_balance.join(plp_coin.into_balance());

        // plp_received > 0 guaranteed: predict::supply aborts on EZeroSharesMinted.
        let mark = (amount as u128) * Q64 / (plp_received as u128);
        record_plp_mark(vault, mark, clock);

        event::emit(PlpSupplied {
            vault_id: vault.id.to_inner(),
            quote_in: amount,
            plp_received,
            mark_q64: mark,
        });
    }

    /// Burn PLP from `plp_balance` via `predict::withdraw`, pulling the quote
    /// proceeds into idle. Deliberately NOT gated on `paused`: during an
    /// emergency the operator must still be able to restore withdrawal
    /// liquidity. Mark refreshes from the execution price.
    ///
    /// `predict::withdraw` may abort with EWithdrawExceedsAvailable when the
    /// pool's free balance is consumed by open bet liabilities — retry smaller.
    public fun redeem_plp_to_idle<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        predict: &mut Predict,
        plp_shares: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        assert!(plp_shares > 0, EZeroAmount);
        assert!(plp_shares <= vault.plp_balance.value(), EInsufficientPlp);

        let plp_coin: Coin<PLP> = coin::take(&mut vault.plp_balance, plp_shares, ctx);
        let quote_coin = predict::withdraw<Quote>(predict, plp_coin, clock, ctx);
        let quote_received = quote_coin.value();
        vault.idle.join(quote_coin.into_balance());

        // quote_received > 0 guaranteed: predict::withdraw aborts on EZeroAmount.
        let mark = (quote_received as u128) * Q64 / (plp_shares as u128);
        record_plp_mark(vault, mark, clock);

        event::emit(PlpRedeemed {
            vault_id: vault.id.to_inner(),
            plp_burned: plp_shares,
            quote_received,
            mark_q64: mark,
        });
    }
```

### Task 5: Test-only variants

**Files:** Modify `move/hunchbook_vault/sources/vault.move` (test-only block, after
`withdraw_unchecked` line 641)

- [ ] **Step 5.1:**

```move
    #[test_only]
    /// Mirror of `supply_idle_to_plp` that takes a pre-minted PLP coin instead
    /// of calling `predict::supply` (whose test constructor is package-private
    /// upstream). Accounting and mark semantics match production exactly.
    public fun supply_idle_to_plp_for_testing<Quote>(
        vault: &mut Vault<Quote>,
        amount: u64,
        plp_received: Coin<PLP>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(!vault.paused, EPaused);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= vault.idle.value(), EInsufficientIdle);
        let quote = vault.idle.split(amount);
        balance::destroy_for_testing(quote);
        let shares = plp_received.value();
        vault.plp_balance.join(plp_received.into_balance());
        let mark = (amount as u128) * Q64 / (shares as u128);
        record_plp_mark(vault, mark, clock);
    }

    #[test_only]
    /// Mirror of `redeem_plp_to_idle`: caller supplies the simulated
    /// `Coin<Quote>` that `predict::withdraw` would have returned.
    public fun redeem_plp_to_idle_for_testing<Quote>(
        vault: &mut Vault<Quote>,
        plp_shares: u64,
        quote_received: Coin<Quote>,
        clock: &Clock,
        _ctx: &mut TxContext,
    ) {
        assert!(plp_shares > 0, EZeroAmount);
        assert!(plp_shares <= vault.plp_balance.value(), EInsufficientPlp);
        let burned = vault.plp_balance.split(plp_shares);
        balance::destroy_for_testing(burned);
        let amount = quote_received.value();
        vault.idle.join(quote_received.into_balance());
        let mark = (amount as u128) * Q64 / (plp_shares as u128);
        record_plp_mark(vault, mark, clock);
    }
```

Note: the `for_testing` supply divides by `shares` — tests must pass a non-zero PLP coin
(production guarantees this via the upstream abort).

### Task 6: Tests

**Files:** Modify `move/hunchbook_vault/tests/vault_tests.move`

- [ ] **Step 6.1:** Add `use deepbook_predict::plp::PLP;` to the imports.

- [ ] **Step 6.2:** Append a new section with these tests (constants: `QUOTE_1K`, helpers:
`setup`, `deposit_unchecked`; Q64 expressed as `1u128 << 64`):

```move
    // =====================================================================
    // PLP supply / redeem / mark
    // =====================================================================

    const Q64_TEST: u128 = 1 << 64;

    #[test]
    fun genesis_plp_mark_is_zero_and_plp_value_zero() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let vault = scenario.take_shared<Vault<SUI>>();
            assert_eq!(vault::plp_mark_q64(&vault), 0);
            assert_eq!(vault::plp_mark_ms(&vault), 0);
            assert_eq!(vault::plp_value(&vault), 0);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun supply_moves_idle_into_plp_and_marks_at_execution_price() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
            ts::return_shared(vault);
        };
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            // 600 quote buys 600 PLP → mark 1.0 (Q64)
            let plp = coin::mint_for_testing<PLP>(600_000_000, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(
                &mut vault, 600_000_000, plp, &clock, scenario.ctx(),
            );
            assert_eq!(vault::idle(&vault), QUOTE_1K - 600_000_000);
            assert_eq!(vault::plp_balance(&vault), 600_000_000);
            assert_eq!(vault::plp_mark_q64(&vault), Q64_TEST);
            assert_eq!(vault::plp_value(&vault), 600_000_000);
            // NAV invariant: supplying at par leaves NAV unchanged
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun supply_at_premium_marks_above_one() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
            ts::return_shared(vault);
        };
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            // 500 quote buys only 400 PLP → mark 1.25, value 400 × 1.25 = 500
            let plp = coin::mint_for_testing<PLP>(400_000_000, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(
                &mut vault, 500_000_000, plp, &clock, scenario.ctx(),
            );
            assert_eq!(vault::plp_mark_q64(&vault), Q64_TEST * 5 / 4);
            assert_eq!(vault::plp_value(&vault), 500_000_000);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test, expected_failure(abort_code = vault::EZeroAmount)]
    fun supply_zero_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(1, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, 0, plp, &clock, scenario.ctx());
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test, expected_failure(abort_code = vault::EInsufficientIdle)]
    fun supply_above_idle_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(1, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, 1, plp, &clock, scenario.ctx());
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test]
    fun keeper_mark_within_bound_moves_nav() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
            ts::return_shared(vault);
        };
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, &clock, scenario.ctx());
            // keeper marks +10% → NAV grows 10%
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 11 / 10, &clock);
            assert_eq!(vault::plp_value(&vault), QUOTE_1K * 11 / 10);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K * 11 / 10);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test, expected_failure(abort_code = vault::EMarkDrift)]
    fun keeper_mark_beyond_drift_bound_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST, &clock); // first set: free
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 13 / 10, &clock); // +30% → abort
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test, expected_failure(abort_code = vault::EZeroMark)]
    fun keeper_mark_zero_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &cap, 0, &clock);
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test]
    fun redeem_round_trips_at_par_and_appreciated_redeem_grows_idle() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
            ts::return_shared(vault);
        };
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, &clock, scenario.ctx());
            assert_eq!(vault::idle(&vault), 0);

            // pool appreciated 5%: redeeming all PLP returns 1050
            let quote_back = coin::mint_for_testing<SUI>(QUOTE_1K + 50_000_000, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(
                &mut vault, QUOTE_1K, quote_back, &clock, scenario.ctx(),
            );
            assert_eq!(vault::idle(&vault), QUOTE_1K + 50_000_000);
            assert_eq!(vault::plp_balance(&vault), 0);
            assert_eq!(vault::plp_value(&vault), 0);
            // mark recorded at redemption price 1.05
            assert_eq!(vault::plp_mark_q64(&vault), Q64_TEST * 105 / 100);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K + 50_000_000);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test, expected_failure(abort_code = vault::EInsufficientPlp)]
    fun redeem_above_plp_balance_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let quote_back = coin::mint_for_testing<SUI>(1, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(&mut vault, 1, quote_back, &clock, scenario.ctx());
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test]
    fun full_lp_cycle_deposit_supply_appreciate_redeem_withdraw() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);

        // 1. Alice deposits 1k
        scenario.next_tx(ALICE);
        let alice_shares = {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            let s = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            ts::return_shared(vault);
            s
        };

        // 2. Operator supplies all 1k to PLP at par
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, &clock, scenario.ctx());
            ts::return_shared(vault);
        };

        // 3. Keeper marks +8% — share price follows
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 108 / 100, &clock);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K * 108 / 100);
            ts::return_shared(vault);
        };

        // 4. Operator redeems everything at the appreciated price
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let appreciated = QUOTE_1K * 108 / 100;
            let quote_back = coin::mint_for_testing<SUI>(appreciated, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(
                &mut vault, QUOTE_1K, quote_back, &clock, scenario.ctx(),
            );
            ts::return_shared(vault);
        };

        // 5. Alice withdraws all shares and realizes the 8% gain
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let out = vault::withdraw_unchecked(&mut vault, alice_shares, scenario.ctx());
            assert_eq!(out.value(), QUOTE_1K * 108 / 100);
            assert_eq!(vault::nav_unchecked(&vault), 0);
            assert_eq!(vault::total_shares(&vault), 0);
            destroy(out);
            ts::return_shared(vault);
        };

        destroy(clock);
        destroy(cap);
        scenario.end();
    }
```

### Task 7: Verify + document

- [ ] **Step 7.1:** `cd move/hunchbook_vault && sui move test --gas-limit 100000000000` →
  expect 31 baseline + 11 new = 42 passed, zero failures, zero warnings.
- [ ] **Step 7.2:** `bunx prettier-move -c sources/vault.move tests/vault_tests.move --write`.
- [ ] **Step 7.3:** Update `move/hunchbook_vault/PLAN.md`: move the "PLP redeem/supply integration"
  bullet from "Open questions deferred" into a new "Resolved" section noting mark-based
  valuation and pointing at this plan; add the three new operator functions + views to the
  public-surface listing.
- [ ] **Step 7.4:** Hand off: deployment of the updated vault package to testnet (and the
  keeper that posts marks) happen in the keeper/deploy task, not this plan.

## Self-review notes

- Old plan's Tasks 2 (field) ✅ pre-done; Task 1 (upstream) dropped with verified rationale;
  Tasks 3-6 semantics preserved but mark-based; signatures of `nav`/`deposit`/`withdraw`/
  `accrue_fees` unchanged → zero churn in callers and existing 31 tests.
- Q64 drift math: `diff × 10_000 ≤ current × 2_000` — u128 overflow safe (mark ≈ 2^64,
  ×10^4 ≪ 2^128).
- Execution-mark division safety documented (upstream aborts guarantee non-zero divisors).
- Perf fees on PLP gains: `accrue_fees` reads `nav` which now includes marked PLP value —
  perf fee correctly crystallizes on keeper mark-ups; no new fee code needed.
