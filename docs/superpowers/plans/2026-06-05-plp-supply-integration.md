# PLP Supply Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Hunchbook vault so it can supply idle `Coin<Quote>` into the DeepBook Predict PLP pool, hold the resulting `Coin<PLP>`, value its PLP holdings at real-time NAV, and redeem PLP back to `Coin<Quote>` for LP withdrawals. This is the missing link between "vault accepts deposits" and "vault produces APY."

**Architecture:** Add two tiny `public fun` readers to `deepbook_predict::predict` exposing PLP supply and per-share quote value (one-line wrappers around already-existing private logic). Store PLP holdings in the vault as `Balance<PLP>`. Two new operator functions — `supply_idle_to_plp` and `redeem_plp_to_idle` — move value between `idle: Balance<Quote>` and `plp_balance: Balance<PLP>` by calling `predict::supply` / `predict::withdraw`. `nav` aggregates idle + manager-deployed principal + real-time PLP value, minus accrued fees. Tests use `#[test_only]` variants that accept a synthetic `Coin<PLP>` so accounting can be exercised without instantiating a full `Predict` object — same pattern already used for `deposit_unchecked` / `withdraw_unchecked`.

**Tech Stack:** Sui Move 2024, Move 2024.beta edition, `sui move test --gas-limit 100000000000`, `bunx prettier-move`.

---

## Pre-flight: scope and assumptions verified against current code

Verified by reading the codebase before writing this plan:

- `move/hunchbook_vault/sources/vault.move:40-61` — `Vault<phantom Quote>` struct has `idle: Balance<Quote>`, `deployed_principal: u64`, no PLP holding today.
- `move/hunchbook_vault/sources/vault.move:202-213` — `nav` and `share_price_q64` already accept `&PredictManager` but only count `idle + deployed_principal - fees`. The doc-comment at line 199-201 explicitly anticipates V2 adding PLP value lookup.
- `deepbookv3-src/packages/predict/sources/predict.move:437-468` — `public fun supply<Quote>(predict: &mut Predict, coin: Coin<Quote>, clock: &Clock, ctx: &mut TxContext): Coin<PLP>` is the supply path. Aborts on `EZeroAmount`, `EZeroVaultValue` (if predict vault is empty but total_supply > 0), `EZeroSharesMinted`.
- `deepbookv3-src/packages/predict/sources/predict.move:474-502` — `public fun withdraw<Quote>(predict: &mut Predict, lp_coin: Coin<PLP>, clock: &Clock, ctx: &mut TxContext): Coin<Quote>` is the redeem path. Aborts on `EZeroAmount`, `EWithdrawExceedsAvailable` (when vault balance minus open positions' max payout is too small).
- `deepbookv3-src/packages/predict/sources/predict.move:799-804` — `shares_to_amount` is **private**, no public reader for "what is X PLP worth?". This is the gap we must close.
- `deepbookv3-src/packages/predict/sources/predict.move:703-723` — `create_test_predict` is `public(package)`, so external test code (i.e. `hunchbook_vault::vault_tests`) cannot instantiate a real `Predict`. Tests must use `#[test_only]` accounting-only variants, same as the existing `deposit_unchecked` / `withdraw_unchecked` / `nav_unchecked`.
- `deepbookv3-src/packages/predict/sources/vault/plp.move` — `PLP` has only `drop`, the `TreasuryCap<PLP>` is held by `Predict`. `coin::mint_for_testing<PLP>(...)` works for test fixtures because PLP is registered as a currency.
- `move/hunchbook_vault/Move.toml` — already depends on `deepbook_predict` local; no new dependency needed.

**Design decision (must flag for review before Task 1):** This plan modifies vendored upstream `deepbookv3-src/packages/predict/sources/predict.move` to add two thin public readers. The alternative is to track PLP at supplied-principal value in the vault (NAV under-reports PLP gains until redemption, so mgmt/perf fees are wrong and LPs who withdraw mid-cycle leave value behind). The upstream change is strictly additive (no behavior change to existing callers) and is the only architecturally correct path. **If the user does not want to touch upstream, stop and re-plan with the principal-tracking alternative.**

---

## File Structure

Files to modify:

- `deepbookv3-src/packages/predict/sources/predict.move` — add two `public fun` readers: `plp_total_supply(predict: &Predict): u64` and `plp_value_of(predict: &Predict, shares: u64): u64`. Each is a one-line wrapper around existing private logic.
- `move/hunchbook_vault/sources/vault.move` — add `plp_balance: Balance<PLP>` field; new operator functions `supply_idle_to_plp` and `redeem_plp_to_idle`; update `nav` / `nav_unchecked` to incorporate PLP value; add new events `PlpSupplied`, `PlpRedeemed`; add new error code `EInsufficientPlp`; add `plp_balance` getter; add `#[test_only]` variants for accounting tests.
- `move/hunchbook_vault/tests/vault_tests.move` — add tests for the new accounting paths (supply increases PLP balance, NAV reflects PLP gains, redeem restores idle, expected-failure cases).
- `move/hunchbook_vault/PLAN.md` — flip the "Open question: PLP redeem/supply integration" bullet to a "Resolved" entry pointing at the implementation; document the new operator surface.

No new files. No changes to `pf_share.move`, `hedge_policy.move`, or the router package.

---

## Conventions for every task in this plan

- Edition is Move 2024.beta — module label syntax (`module x::y;`), no curly-brace module.
- Error constants are `EPascalCase`. Math constants are `ALL_CAPS`. Events are past tense.
- LP-facing functions never take `&AdminCap`. Operator-facing functions always take `&AdminCap` as the second arg, then objects, then primitives, with `&Clock` and `&mut TxContext` last.
- After every code change to `.move` files: run `bunx prettier-move -c <file> --write` to format.
- After every task: run the relevant package's tests with `sui move test --gas-limit 100000000000` from inside the package directory. Zero failures, zero warnings, before commit.
- Every `expected_failure` test names the exact abort code via `abort_code = vault::E…` and ends with a `abort` after the failure-line to distinguish "failed at the right place" from "failed at the trailing guard."
- Commit between tasks. Commit message format: `feat(vault): <one-line>` or `feat(predict): <one-line>` matching the touched package.

---

## Task 1: Expose PLP value readers in `predict.move`

**Why this task first:** `vault::nav` cannot value held PLP without these readers, and every subsequent task depends on the readers existing. This is a strictly additive change to upstream — no existing caller is touched.

**Why no dedicated tests in this task:** Both readers are one-line delegations to already-tested private logic (`treasury_cap.total_supply()`, `shares_to_amount`, `vault.vault_value()`). The predict package has no existing supply-flow tests and `create_test_predict` is `public(package)`, so writing a standalone unit test would require building a full Currency / oracle / clock fixture for a two-line wrapper. Coverage comes from Task 6's integration test, which exercises both readers end-to-end via the full deposit → supply → redeem → withdraw cycle. **Verified** by `find packages/predict -name "*.move" | xargs grep -l "#\[test\]"` returning only `tests/helper/rate_limiter_tests.move` — there is no precedent supply test to mirror.

**Files:**
- Modify: `deepbookv3-src/packages/predict/sources/predict.move` (add two public functions in the read-only views section, near line 565 where `trading_paused` lives)

- [ ] **Step 1: Verify current compile baseline**

Run: `cd /Users/keshav/Downloads/deepbook/deepbookv3-src/packages/predict && sui move build --skip-fetch-latest-git-deps`
Expected: build succeeds with no errors. This establishes the baseline so any breakage in Step 3 is attributable to our edit.

- [ ] **Step 2: Add the two public readers to `predict.move`**

In `predict.move`, find the public read-only views block (around line 565-700, where `trading_paused`, `base_spread`, `accepted_quotes`, `available_withdrawal`, etc. live) and add these two functions in the same block. Keep them ordered between `available_withdrawal` and the `#[test_only]` section:

```move
/// Total number of PLP shares currently outstanding.
public fun plp_total_supply(predict: &Predict): u64 {
    predict.treasury_cap.total_supply()
}

/// Quote-asset value of `shares` PLP at the current vault valuation.
/// Mirrors the math used inside `withdraw` so external integrators can
/// price their PLP holdings without re-deriving the formula.
public fun plp_value_of(predict: &Predict, shares: u64): u64 {
    predict.shares_to_amount(shares, predict.vault.vault_value())
}
```

Notes:
- `predict.treasury_cap.total_supply()` is the inverted-method-syntax form of `coin::total_supply(&predict.treasury_cap)` — confirmed valid in this file (see line 800 for an identical inside-the-module call).
- `shares_to_amount` (line 799) already has the right rounding and zero-guards; we delegate to it. **Do not duplicate the formula.**
- The use of `predict.vault.vault_value()` is the same call already made at line 447 and line 480, so no new private-field access is introduced.

- [ ] **Step 3: Build + run existing tests to verify nothing regressed**

Run: `cd /Users/keshav/Downloads/deepbook/deepbookv3-src/packages/predict && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: build succeeds; existing tests (`tests/helper/rate_limiter_tests.move`) still pass; zero warnings.

If any warning appears (e.g. unused mut, unused variable), fix it before committing — `move.md` rule.

- [ ] **Step 4: Format the modified file**

Run: `cd /Users/keshav/Downloads/deepbook/deepbookv3-src/packages/predict/sources && bunx prettier-move -c predict.move --write`
Expected: file rewritten, no errors. If diff is non-empty, that's fine — formatting only.

- [ ] **Step 5: Commit**

```bash
cd /Users/keshav/Downloads/deepbook/deepbookv3-src
git add packages/predict/sources/predict.move
git commit -m "feat(predict): expose plp_total_supply and plp_value_of public readers"
```

---

## Task 2: Add `Balance<PLP>` field to the vault struct, no behavior change

**Why:** Subsequent operator functions need a place to hold PLP. Doing this as a separate task keeps the diff small — only struct/`new`/`nav_unchecked` change, no new logic — and ensures existing tests still pass before we layer behavior on top.

**Files:**
- Modify: `move/hunchbook_vault/sources/vault.move`
- Test: `move/hunchbook_vault/tests/vault_tests.move` (verify no regression)

- [ ] **Step 1: Add a failing assertion that the vault exposes a zero `plp_balance` at genesis**

Add to `vault_tests.move` near the existing `first_deposit_mints_one_to_one_and_share_price_unchanged` test:

```move
#[test]
fun vault_at_genesis_holds_zero_plp() {
    let mut scenario = ts::begin(ADMIN);
    let (clock, cap) = setup(&mut scenario);
    scenario.next_tx(ADMIN);
    {
        let vault = scenario.take_shared<Vault<SUI>>();
        assert_eq!(vault::plp_balance(&vault), 0);
        ts::return_shared(vault);
    };
    destroy(clock);
    destroy(cap);
    scenario.end();
}
```

- [ ] **Step 2: Run test, verify it fails on the missing accessor**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps vault_at_genesis_holds_zero_plp`
Expected: compile failure with `Unbound function 'plp_balance' in module 'vault'`.

- [ ] **Step 3: Modify the `Vault` struct, `new`, and accessor**

In `vault.move`:

1. Add an import next to the existing `predict` import (line 16-17):

```move
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::plp::PLP;
```

2. Add the field to the `Vault<phantom Quote>` struct (after `idle: Balance<Quote>,` on line 42 — keep PLP grouped with idle since both are "value held directly by the vault"):

```move
public struct Vault<phantom Quote> has key {
    id: UID,
    idle: Balance<Quote>,
    /// PLP shares owned by the vault. Earned by `supply_idle_to_plp` and
    /// burned back to `Coin<Quote>` by `redeem_plp_to_idle`. Valued in NAV
    /// at `predict::plp_value_of(predict, plp_balance.value())`.
    plp_balance: Balance<PLP>,
    deployed_principal: u64,
    treasury: TreasuryCap<PF_SHARE>,
    // ... rest unchanged
}
```

3. Initialize the new field in `new` (line 166-182). Add the line between `idle` and `deployed_principal`:

```move
let vault = Vault<Quote> {
    id,
    idle: balance::zero(),
    plp_balance: balance::zero(),
    deployed_principal: 0,
    // ... rest unchanged
};
```

4. Add the public accessor next to the existing `idle` accessor (line 215):

```move
public fun idle<Quote>(vault: &Vault<Quote>): u64 { vault.idle.value() }
public fun plp_balance<Quote>(vault: &Vault<Quote>): u64 { vault.plp_balance.value() }
public fun deployed_principal<Quote>(vault: &Vault<Quote>): u64 { vault.deployed_principal }
```

- [ ] **Step 4: Run full vault test suite, verify nothing regresses**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: every existing test still passes; the new `vault_at_genesis_holds_zero_plp` passes. Zero warnings.

- [ ] **Step 5: Format and commit**

```bash
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/sources && bunx prettier-move -c vault.move --write
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/tests && bunx prettier-move -c vault_tests.move --write
cd /Users/keshav/Downloads/deepbook && git add move/hunchbook_vault/sources/vault.move move/hunchbook_vault/tests/vault_tests.move
git commit -m "feat(vault): add plp_balance field and accessor"
```

---

## Task 3: NAV and `nav_unchecked` include PLP value

**Why before supply/redeem:** Once `supply_idle_to_plp` lands, it will mutate `plp_balance`. The NAV math must already account for PLP so the post-supply round-trip invariant ("supply N quote ⇒ NAV unchanged within rounding") holds atomically.

**Files:**
- Modify: `move/hunchbook_vault/sources/vault.move`
- Test: `move/hunchbook_vault/tests/vault_tests.move`

- [ ] **Step 1: Write a failing test for `nav_unchecked` including PLP**

Add a new `#[test_only]` accounting variant in `vault.move` so the test can inject a PLP coin without touching `Predict`. Then write the test.

In `vault.move`, add to the test-only block (around line 553):

```move
#[test_only]
/// Test variant of `nav_unchecked` that values PLP holdings at `plp_quote_value`
/// rather than reading from `Predict`. Lets unit tests exercise the aggregation
/// logic without standing up a full predict object.
public fun nav_with_plp_for_testing<Quote>(vault: &Vault<Quote>, plp_quote_value: u64): u64 {
    let gross = vault.idle.value() + vault.deployed_principal + plp_quote_value;
    let fees = vault.accrued_perf.value() + vault.accrued_mgmt.value();
    if (fees >= gross) 0 else gross - fees
}

#[test_only]
/// Test variant of `supply_idle_to_plp` that accepts a pre-minted PLP coin
/// rather than calling `predict::supply`. Used by accounting tests; the real
/// supply path is `supply_idle_to_plp`.
public fun supply_idle_to_plp_for_testing<Quote>(
    vault: &mut Vault<Quote>,
    amount_in: u64,
    plp_received: Coin<PLP>,
    _ctx: &mut TxContext,
) {
    assert!(amount_in > 0, EZeroAmount);
    assert!(amount_in <= vault.idle.value(), EInsufficientIdle);
    let _quote = vault.idle.split(amount_in);
    // In the real path this Quote balance is consumed by predict::supply. The
    // test variant discards it because we're not actually calling supply; the
    // PLP coin is provided directly by the caller.
    sui::balance::destroy_for_testing(_quote);
    vault.plp_balance.join(plp_received.into_balance());
}
```

Add the test in `vault_tests.move`:

```move
#[test]
fun nav_includes_plp_holdings_valued_at_plp_quote_value() {
    let mut scenario = ts::begin(ADMIN);
    let (clock, cap) = setup(&mut scenario);

    scenario.next_tx(ALICE);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
        let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
        // simulate operator supplying 600 of the 1000 idle into PLP, receiving 600 PLP shares
        let fake_plp = coin::mint_for_testing<deepbook_predict::plp::PLP>(600_000_000, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, 600_000_000, fake_plp, scenario.ctx());
        assert_eq!(vault::idle(&vault), QUOTE_1K - 600_000_000);
        assert_eq!(vault::plp_balance(&vault), 600_000_000);
        // PLP is worth 1:1 → total NAV equals original deposit
        assert_eq!(vault::nav_with_plp_for_testing(&vault, 600_000_000), QUOTE_1K);
        // If PLP appreciates 10% → NAV grows by 60
        assert_eq!(vault::nav_with_plp_for_testing(&vault, 660_000_000), QUOTE_1K + 60_000_000);
        destroy(shares);
        ts::return_shared(vault);
    };
    destroy(clock);
    destroy(cap);
    scenario.end();
}
```

(Top of `vault_tests.move`, ensure the import line exists: `use deepbook_predict::plp::PLP;` — add it if missing.)

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps nav_includes_plp`
Expected: compile failure on `nav_with_plp_for_testing` / `supply_idle_to_plp_for_testing` (since the test-only helpers were added in the same step the test was — verify by running, expect any earlier ordering mistake).

- [ ] **Step 3: Update the real `nav` to read PLP value from Predict**

In `vault.move`, replace the body of `nav` (line 202-207):

```move
public fun nav<Quote>(vault: &Vault<Quote>, predict: &Predict, manager: &PredictManager): u64 {
    assert_manager(vault, manager);
    let plp_value = predict::plp_value_of(predict, vault.plp_balance.value());
    let gross = vault.idle.value() + vault.deployed_principal + plp_value;
    let fees = vault.accrued_perf.value() + vault.accrued_mgmt.value();
    if (fees >= gross) 0 else gross - fees
}
```

And update `share_price_q64` similarly (line 209-213):

```move
public fun share_price_q64<Quote>(vault: &Vault<Quote>, predict: &Predict, manager: &PredictManager): u128 {
    let total = coin::total_supply(&vault.treasury);
    if (total == 0) Q64
    else (nav(vault, predict, manager) as u128) * Q64 / (total as u128)
}
```

**Callers that must update their signature:** `deposit` (line 235), `withdraw` (line 267), `accrue_fees` (line 443). Each gained a `&Predict` parameter. Add it after the existing `&PredictManager` parameter in each signature, and pass it through to `nav` / `share_price_q64` at the call sites. Do not change the order of any existing parameter.

Update the doc-comment at line 199-201 — remove the "V2 (which adds PLP value lookup) doesn't break callers" line, since this IS that V2.

- [ ] **Step 4: Update `nav_unchecked` to take PLP value as a parameter**

The unchecked test variant must mirror the production semantics. Replace `nav_unchecked` and `share_price_q64_unchecked` (line 577-588):

```move
#[test_only]
public fun nav_unchecked<Quote>(vault: &Vault<Quote>): u64 {
    nav_with_plp_for_testing(vault, 0)
}

#[test_only]
public fun share_price_q64_unchecked<Quote>(vault: &Vault<Quote>): u128 {
    let total = coin::total_supply(&vault.treasury);
    if (total == 0) Q64
    else (nav_unchecked(vault) as u128) * Q64 / (total as u128)
}
```

This preserves the existing API used by all existing tests (which all pass `plp_balance == 0` implicitly).

- [ ] **Step 5: Run full vault test suite, verify everything still passes**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: every existing test still passes (because they all have zero PLP balance). The new `nav_includes_plp_holdings_valued_at_plp_quote_value` passes. Zero warnings.

- [ ] **Step 6: Format and commit**

```bash
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/sources && bunx prettier-move -c vault.move --write
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/tests && bunx prettier-move -c vault_tests.move --write
cd /Users/keshav/Downloads/deepbook && git add move/hunchbook_vault
git commit -m "feat(vault): NAV reads PLP holdings via predict::plp_value_of"
```

---

## Task 4: `supply_idle_to_plp` operator function

**Files:**
- Modify: `move/hunchbook_vault/sources/vault.move`
- Test: `move/hunchbook_vault/tests/vault_tests.move`

- [ ] **Step 1: Write the failing test for the accounting variant**

Add to `vault_tests.move`:

```move
#[test]
fun supply_idle_to_plp_for_testing_moves_idle_into_plp_balance() {
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
        let fake_plp = coin::mint_for_testing<PLP>(750_000_000, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, 750_000_000, fake_plp, scenario.ctx());
        assert_eq!(vault::idle(&vault), QUOTE_1K - 750_000_000);
        assert_eq!(vault::plp_balance(&vault), 750_000_000);
        // Round-trip NAV invariant: if PLP is valued 1:1 the supply leaves NAV unchanged
        assert_eq!(vault::nav_with_plp_for_testing(&vault, 750_000_000), QUOTE_1K);
        ts::return_shared(vault);
    };

    destroy(clock);
    destroy(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = vault::EZeroAmount)]
fun supply_idle_to_plp_for_testing_zero_aborts() {
    let mut scenario = ts::begin(ADMIN);
    let (_clock, _cap) = setup(&mut scenario);
    scenario.next_tx(ADMIN);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let fake_plp = coin::mint_for_testing<PLP>(0, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, 0, fake_plp, scenario.ctx());
        ts::return_shared(vault);
    };
    abort 999
}

#[test, expected_failure(abort_code = vault::EInsufficientIdle)]
fun supply_idle_to_plp_for_testing_above_idle_aborts() {
    let mut scenario = ts::begin(ADMIN);
    let (_clock, _cap) = setup(&mut scenario);
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
        let fake_plp = coin::mint_for_testing<PLP>(QUOTE_1K + 1, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K + 1, fake_plp, scenario.ctx());
        ts::return_shared(vault);
    };
    abort 999
}
```

- [ ] **Step 2: Run tests, verify the new ones fail (the helpers added in Task 3 step 1 must already be present)**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps supply_idle_to_plp`
Expected: tests run and either pass (if Task 3 helpers were sufficient) or fail with specific assertion mismatches. Adjust expectations to match actual outputs.

If the helpers from Task 3 do not yet abort with the right codes, refine `supply_idle_to_plp_for_testing` in `vault.move`:

```move
#[test_only]
public fun supply_idle_to_plp_for_testing<Quote>(
    vault: &mut Vault<Quote>,
    amount_in: u64,
    plp_received: Coin<PLP>,
    _ctx: &mut TxContext,
) {
    assert!(amount_in > 0, EZeroAmount);
    assert!(amount_in <= vault.idle.value(), EInsufficientIdle);
    let burned = vault.idle.split(amount_in);
    sui::balance::destroy_for_testing(burned);
    vault.plp_balance.join(plp_received.into_balance());
}
```

- [ ] **Step 3: Add the production `supply_idle_to_plp` function**

In `vault.move`, in the operator-facing section after `reclaim_idle` (after line 341), add:

```move
/// Move quote from the vault's idle balance into the PLP pool. Returns nothing —
/// the resulting `Coin<PLP>` is retained inside the vault's `plp_balance`.
///
/// The signer must own the vault's `AdminCap` (vault gating). The PLP supply
/// itself has no signer check; `predict::supply` is permissionless.
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

    let coin: Coin<Quote> = coin::take(&mut vault.idle, amount, ctx);
    let plp_coin = predict::supply<Quote>(predict, coin, clock, ctx);
    let shares_received = plp_coin.value();
    vault.plp_balance.join(plp_coin.into_balance());

    event::emit(PlpSupplied {
        vault_id: vault.id.to_inner(),
        quote_amount: amount,
        plp_received: shares_received,
    });
}
```

Add the event struct alongside the other events (near line 122-137):

```move
public struct PlpSupplied has copy, drop, store {
    vault_id: ID,
    quote_amount: u64,
    plp_received: u64,
}
```

Notes:
- We deliberately **do not** route through `PredictManager` for PLP supply. PLP supply is permissionless (`predict::supply` has no `ENotOwner` check — see predict.move line 437-468). The manager exists to hold capital earmarked for *minting bets* (hedge wings), which **does** assert ownership.
- The `&mut Predict` parameter does not break sharing — `Predict` is a shared object (predict.move line 531) so transactions can take `&mut` to it.

- [ ] **Step 4: Run tests, verify everything passes**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: all existing tests pass, the three new supply tests pass. Zero warnings.

- [ ] **Step 5: Format and commit**

```bash
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/sources && bunx prettier-move -c vault.move --write
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/tests && bunx prettier-move -c vault_tests.move --write
cd /Users/keshav/Downloads/deepbook && git add move/hunchbook_vault
git commit -m "feat(vault): supply_idle_to_plp routes idle into Predict PLP pool"
```

---

## Task 5: `redeem_plp_to_idle` operator function

**Files:**
- Modify: `move/hunchbook_vault/sources/vault.move`
- Test: `move/hunchbook_vault/tests/vault_tests.move`

- [ ] **Step 1: Write the failing test for the accounting variant**

Add the test-only helper first (in `vault.move`, alongside `supply_idle_to_plp_for_testing`):

```move
#[test_only]
/// Test variant of `redeem_plp_to_idle`. The caller provides the simulated
/// `Coin<Quote>` returned by `predict::withdraw`; this helper updates the
/// vault's idle and plp_balance to match.
public fun redeem_plp_to_idle_for_testing<Quote>(
    vault: &mut Vault<Quote>,
    plp_shares: u64,
    quote_received: Coin<Quote>,
    _ctx: &mut TxContext,
) {
    assert!(plp_shares > 0, EZeroAmount);
    assert!(plp_shares <= vault.plp_balance.value(), EInsufficientPlp);
    let burned = vault.plp_balance.split(plp_shares);
    sui::balance::destroy_for_testing(burned);
    vault.idle.join(quote_received.into_balance());
}
```

Add the new error code at the top of the error block (line 38):

```move
const EInsufficientPlp: u64 = 11;
```

Add the tests in `vault_tests.move`:

```move
#[test]
fun redeem_plp_to_idle_for_testing_round_trips_back_to_idle_at_par() {
    let mut scenario = ts::begin(ADMIN);
    let (clock, cap) = setup(&mut scenario);

    scenario.next_tx(ALICE);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
        destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
        let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, scenario.ctx());
        assert_eq!(vault::idle(&vault), 0);
        assert_eq!(vault::plp_balance(&vault), QUOTE_1K);

        // Simulate predict::withdraw paying back exactly QUOTE_1K (par redemption)
        let quote_back = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
        vault::redeem_plp_to_idle_for_testing(&mut vault, QUOTE_1K, quote_back, scenario.ctx());
        assert_eq!(vault::idle(&vault), QUOTE_1K);
        assert_eq!(vault::plp_balance(&vault), 0);
        ts::return_shared(vault);
    };

    destroy(clock);
    destroy(cap);
    scenario.end();
}

#[test]
fun redeem_plp_to_idle_for_testing_with_appreciated_quote_grows_idle() {
    let mut scenario = ts::begin(ADMIN);
    let (clock, cap) = setup(&mut scenario);

    scenario.next_tx(ALICE);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
        destroy(vault::deposit_unchecked(&mut vault, pay, scenario.ctx()));
        let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, scenario.ctx());

        // PLP appreciated 5% → redeeming all returns 1050 quote
        let quote_back = coin::mint_for_testing<SUI>(QUOTE_1K + 50_000_000, scenario.ctx());
        vault::redeem_plp_to_idle_for_testing(&mut vault, QUOTE_1K, quote_back, scenario.ctx());
        assert_eq!(vault::idle(&vault), QUOTE_1K + 50_000_000);
        assert_eq!(vault::plp_balance(&vault), 0);
        ts::return_shared(vault);
    };

    destroy(clock);
    destroy(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = vault::EZeroAmount)]
fun redeem_plp_to_idle_for_testing_zero_aborts() {
    let mut scenario = ts::begin(ADMIN);
    let (_clock, _cap) = setup(&mut scenario);
    scenario.next_tx(ADMIN);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let quote_back = coin::mint_for_testing<SUI>(0, scenario.ctx());
        vault::redeem_plp_to_idle_for_testing(&mut vault, 0, quote_back, scenario.ctx());
        ts::return_shared(vault);
    };
    abort 999
}

#[test, expected_failure(abort_code = vault::EInsufficientPlp)]
fun redeem_plp_to_idle_for_testing_above_balance_aborts() {
    let mut scenario = ts::begin(ADMIN);
    let (_clock, _cap) = setup(&mut scenario);
    scenario.next_tx(ADMIN);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let quote_back = coin::mint_for_testing<SUI>(1, scenario.ctx());
        vault::redeem_plp_to_idle_for_testing(&mut vault, 1, quote_back, scenario.ctx());
        ts::return_shared(vault);
    };
    abort 999
}
```

- [ ] **Step 2: Run tests, verify they fail then pass after the helpers compile**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps redeem_plp`
Expected: tests pass after the helpers are added. If a test fails, fix the helper or the test until matching.

- [ ] **Step 3: Add the production `redeem_plp_to_idle` function**

In `vault.move`, after `supply_idle_to_plp`:

```move
/// Burn `plp_shares` of the vault's PLP holdings and pull the resulting quote
/// into the vault's idle balance. Used by the operator when LPs need
/// withdrawal liquidity that idle can't cover.
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

    event::emit(PlpRedeemed {
        vault_id: vault.id.to_inner(),
        plp_burned: plp_shares,
        quote_received,
    });
}
```

Add the event struct alongside `PlpSupplied`:

```move
public struct PlpRedeemed has copy, drop, store {
    vault_id: ID,
    plp_burned: u64,
    quote_received: u64,
}
```

Notes:
- `redeem_plp_to_idle` deliberately does **not** gate on `paused`. If the vault is paused for an emergency, the operator may still need to redeem to honor LP withdrawals.
- `predict::withdraw` may abort with `EWithdrawExceedsAvailable` (when predict vault's free balance can't cover the requested quote due to outstanding bet liabilities). That bubble-up is correct — the operator must retry with a smaller `plp_shares`.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: all tests pass; zero warnings.

- [ ] **Step 5: Format and commit**

```bash
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/sources && bunx prettier-move -c vault.move --write
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/tests && bunx prettier-move -c vault_tests.move --write
cd /Users/keshav/Downloads/deepbook && git add move/hunchbook_vault
git commit -m "feat(vault): redeem_plp_to_idle restores liquidity from PLP pool"
```

---

## Task 6: Wire `deposit`, `withdraw`, `accrue_fees` to the new NAV signature and verify full integration

**Why this is a separate task:** Task 3 already changed the `nav` and `share_price_q64` signatures. This task locks down the LP-facing surface to use the new signatures end-to-end and verifies the entire system compiles and tests pass with no warnings. It also adds one integration-flavored test that combines all three new operator functions.

**Files:**
- Modify: `move/hunchbook_vault/sources/vault.move` (already partially done in Task 3 — finalize)
- Test: `move/hunchbook_vault/tests/vault_tests.move`
- Modify: `move/hunchbook_vault/PLAN.md` (close the deferred question)

- [ ] **Step 1: Verify `deposit`, `withdraw`, `accrue_fees` accept `&Predict`**

Read `vault.move` for these functions. Each should now take `predict: &Predict` immediately after the existing `manager: &PredictManager` parameter. The event emission lines should pass the same `&Predict` into `share_price_q64`.

If any of the three still reads the old signature, update it:

```move
public fun deposit<Quote>(
    vault: &mut Vault<Quote>,
    predict: &Predict,
    manager: &PredictManager,
    payment: Coin<Quote>,
    ctx: &mut TxContext,
): Coin<PF_SHARE> {
    // ... body unchanged except nav_before / share_price call sites:
    //   let nav_before = nav(vault, predict, manager);
    //   let share_price = share_price_q64(vault, predict, manager);
}
```

(Same shape for `withdraw` and `accrue_fees`.)

**Argument-order convention rationale (per move.md):** Objects-before-primitives, capability second when one exists. `&Predict` slots in between `&mut Vault` (the receiver) and `&PredictManager` because both are protocol objects, and `&Predict` is the "wider" of the two (Predict owns the protocol state; the manager is per-operator). LP-facing functions skip the cap.

- [ ] **Step 2: Write the integration test that exercises the full deposit → supply → appreciate → redeem → withdraw flow**

Add to `vault_tests.move`:

```move
#[test]
fun full_lp_cycle_supply_appreciate_redeem_withdraw_returns_grown_quote() {
    let mut scenario = ts::begin(ADMIN);
    let (clock, cap) = setup(&mut scenario);

    // 1. Alice deposits 1k quote
    scenario.next_tx(ALICE);
    let alice_shares = {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
        let s = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
        ts::return_shared(vault);
        s
    };

    // 2. Operator supplies 1k to PLP, receiving 1k PLP shares (1:1)
    scenario.next_tx(ADMIN);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let plp = coin::mint_for_testing<PLP>(QUOTE_1K, scenario.ctx());
        vault::supply_idle_to_plp_for_testing(&mut vault, QUOTE_1K, plp, scenario.ctx());
        ts::return_shared(vault);
    };

    // 3. NAV when PLP value grows 8% — share price must scale exactly with PLP gain
    scenario.next_tx(ADMIN);
    {
        let vault = scenario.take_shared<Vault<SUI>>();
        // Inject simulated PLP quote-value
        let appreciated = (QUOTE_1K * 108) / 100;
        assert_eq!(vault::nav_with_plp_for_testing(&vault, appreciated), appreciated);
        ts::return_shared(vault);
    };

    // 4. Operator redeems PLP (simulated 1080 quote received)
    scenario.next_tx(ADMIN);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let appreciated = (QUOTE_1K * 108) / 100;
        let quote_back = coin::mint_for_testing<SUI>(appreciated, scenario.ctx());
        vault::redeem_plp_to_idle_for_testing(&mut vault, QUOTE_1K, quote_back, scenario.ctx());
        assert_eq!(vault::idle(&vault), appreciated);
        assert_eq!(vault::plp_balance(&vault), 0);
        ts::return_shared(vault);
    };

    // 5. Alice withdraws full shares, gets the 8% gain (rounded down by share math)
    scenario.next_tx(ALICE);
    {
        let mut vault = scenario.take_shared<Vault<SUI>>();
        let out = vault::withdraw_unchecked(&mut vault, alice_shares, scenario.ctx());
        let appreciated = (QUOTE_1K * 108) / 100;
        assert_eq!(out.value(), appreciated);
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

- [ ] **Step 3: Run the full vault test suite**

Run: `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: every test passes. Zero warnings.

- [ ] **Step 4: Run the predict package tests once more to ensure no regression from Task 1**

Run: `cd /Users/keshav/Downloads/deepbook/deepbookv3-src/packages/predict && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps`
Expected: every existing predict test passes plus the three new ones from Task 1.

- [ ] **Step 5: Update `move/hunchbook_vault/PLAN.md`**

In `PLAN.md`, find the "Open questions deferred" section (line 311-321). Move the "PLP redeem/supply integration" bullet OUT of that section. Add a new "Resolved" section directly above it:

```markdown
## Resolved

- **PLP redeem/supply integration** (2026-06-05): `supply_idle_to_plp` and
  `redeem_plp_to_idle` are now live in `vault.move`. Vault holds PLP directly
  as `Balance<PLP>`. NAV reflects real-time PLP value via
  `predict::plp_value_of`. See
  `docs/superpowers/plans/2026-06-05-plp-supply-integration.md`.
```

Also update the public-surface block (around line 130-207) to include the new functions, mirroring the style of `mint_hedge_wing`.

- [ ] **Step 6: Format and commit**

```bash
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/sources && bunx prettier-move -c vault.move --write
cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault/tests && bunx prettier-move -c vault_tests.move --write
cd /Users/keshav/Downloads/deepbook && git add move/hunchbook_vault
git commit -m "feat(vault): integrate PLP supply/redeem end-to-end and document in PLAN.md"
```

---

## Self-Review (run before declaring complete)

After all six tasks are committed, verify:

- [ ] `cd /Users/keshav/Downloads/deepbook/deepbookv3-src/packages/predict && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps` → all pass, zero warnings.
- [ ] `cd /Users/keshav/Downloads/deepbook/move/hunchbook_vault && sui move test --gas-limit 100000000000 --skip-fetch-latest-git-deps` → all pass, zero warnings.
- [ ] `git log --oneline -10` shows six new commits with the messages above, in order.
- [ ] `grep -n "TODO\|FIXME\|XXX" move/hunchbook_vault/sources/vault.move` → no new TODOs introduced.
- [ ] Every new `expected_failure` test uses `abort_code = vault::E…` (not a bare number).
- [ ] `nav`, `share_price_q64`, `deposit`, `withdraw`, `accrue_fees` all accept `&Predict` and pass it through correctly.
- [ ] `supply_idle_to_plp` and `redeem_plp_to_idle` are the only two new production entry points; no helper duplicates.

## Out of scope (will NOT be done in this plan)

These have been considered and intentionally deferred:

- **Auto-redeem on `withdraw`** when idle is insufficient. The vault still aborts with `EInsufficientIdle`; operator pre-tops idle via `redeem_plp_to_idle`. Auto-redeem complicates the LP flow with a permissioned predict call from a permissionless entry point, and requires resolving "what if the redeem itself partially fails" — V2 problem.
- **PLP value in `accrue_fees`** beyond what `nav` already provides. The existing fee math reads from `nav(vault, predict, manager)`, which after Task 3 includes PLP value — so perf fees correctly trigger on PLP appreciation. No new fee logic is needed.
- **Skim PLP yield without redeeming** (a "harvest" function that mints fewer PLP than full balance). Possible but adds surface area; `redeem_plp_to_idle` with a smaller `plp_shares` already covers the use case.
- **Multiple Predict pools** (vault supplies into >1 PLP). MVP supplies into exactly one. Multi-pool requires keying by `predict_id` and is a V2 generalization.
- **PredictManager-routed PLP supply.** `predict::supply` is permissionless, so the manager indirection has no benefit and adds an extra `predict_manager::deposit` round-trip. We keep PLP supply direct.
