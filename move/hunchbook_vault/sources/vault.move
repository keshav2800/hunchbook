/// Hunchbook vault — a hedged PLP-yield vault on DeepBook Predict.
///
/// Architecture: see PLAN.md. In brief:
///   - LP-facing surface: `deposit` / `withdraw` / `nav` operate on the vault's
///     own `Balance<Quote>` and the `TreasuryCap<PF_SHARE>` it holds.
///   - Operator-facing surface (gated by `AdminCap`): moves capital between
///     the vault's idle balance and an associated `PredictManager`; mints and
///     redeems OTM-binary hedge wings; manages pause / capacity / fees.
///
/// NAV is tracked exactly via Q64.64 fixed-point share-price arithmetic so
/// deposit and withdraw round-trips don't leak value across LPs.
module hunchbook_vault::vault {
    use deepbook_predict::{
        market_key::MarketKey,
        oracle::OracleSVI,
        plp::PLP,
        predict::{Self, Predict},
        predict_manager::{Self, PredictManager}
    };
    use hunchbook_vault::pf_share::PF_SHARE;
    use sui::{balance::{Self, Balance}, clock::Clock, coin::{Self, Coin, TreasuryCap}, event};

    const BPS_DENOM: u64 = 10_000;
    const MS_PER_YEAR: u64 = 365 * 24 * 60 * 60 * 1_000;
    const Q64: u128 = 1 << 64;
    /// Max relative change a keeper-posted mark may apply per update (20%).
    /// Execution-derived marks (from supply/redeem) bypass this bound — they
    /// are ground truth observed from the protocol itself.
    const MAX_MARK_DRIFT_BPS: u128 = 2_000;

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
    const EInvalidWatermark: u64 = 10;
    const EInsufficientPlp: u64 = 11;
    const EZeroMark: u64 = 12;
    const EMarkDrift: u64 = 13;

    public struct Vault<phantom Quote> has key {
        id: UID,
        idle: Balance<Quote>,
        /// PLP shares owned by the vault. Earned by `supply_idle_to_plp` and
        /// burned back to `Coin<Quote>` by `redeem_plp_to_idle`.
        plp_balance: Balance<PLP>,
        /// Quote value of one PLP share, Q64.64 fixed point. 0 = never set.
        /// Updated (a) from execution prices on every supply/redeem, and
        /// (b) by the keeper via `set_plp_mark` between trades.
        plp_mark_q64: u128,
        /// Timestamp (ms) of the last mark update. UI/keeper staleness signal;
        /// NAV does not hard-gate on it (a dead keeper must not brick withdrawals).
        plp_mark_ms: u64,
        /// Cumulative quote deployed into the manager. Mirrors `manager.balance<Quote>`
        /// modulo PnL from positions; tracked here so NAV reads don't depend on
        /// re-reading the manager when only `idle` has changed.
        deployed_principal: u64,
        treasury: TreasuryCap<PF_SHARE>,
        manager_id: ID,
        capacity_raw: u64,
        paused: bool,
        perf_fee_bps: u16,
        mgmt_fee_bps_yr: u16,
        accrued_perf: Balance<Quote>,
        accrued_mgmt: Balance<Quote>,
        last_mgmt_ms: u64,
        /// High-water mark for performance-fee accrual. Perf fee is charged only on
        /// the increase in share price above this level.
        perf_watermark_q64: u128,
        hedge_sigma_bps: u16,
        hedge_vol_bps: u16,
    }

    public struct AdminCap has key, store {
        id: UID,
        vault_id: ID,
    }

    public struct VaultCreated has copy, drop, store {
        vault_id: ID,
        manager_id: ID,
        capacity_raw: u64,
    }

    public struct Deposited has copy, drop, store {
        vault_id: ID,
        lp: address,
        quote_in: u64,
        shares_out: u64,
        share_price_q64: u128,
    }

    public struct Withdrawn has copy, drop, store {
        vault_id: ID,
        lp: address,
        shares_in: u64,
        quote_out: u64,
        share_price_q64: u128,
    }

    public struct CapacityChanged has copy, drop, store { vault_id: ID, new_cap: u64 }
    public struct Paused has copy, drop, store { vault_id: ID }
    public struct Unpaused has copy, drop, store { vault_id: ID }

    public struct HedgeMinted has copy, drop, store {
        vault_id: ID,
        oracle_id: ID,
        strike: u64,
        is_up: bool,
        quantity: u64,
    }

    public struct HedgeRedeemed has copy, drop, store {
        vault_id: ID,
        oracle_id: ID,
        strike: u64,
        is_up: bool,
        quantity: u64,
    }

    public struct FeesAccrued has copy, drop, store {
        vault_id: ID,
        mgmt_delta: u64,
        perf_delta: u64,
    }

    public struct FeesClaimed has copy, drop, store {
        vault_id: ID,
        mgmt: u64,
        perf: u64,
        to: address,
    }

    public struct CapitalDeployed has copy, drop, store {
        vault_id: ID,
        amount: u64,
    }

    public struct CapitalReclaimed has copy, drop, store {
        vault_id: ID,
        amount: u64,
    }

    public struct HedgeParamsChanged has copy, drop, store {
        vault_id: ID,
        sigma_bps: u16,
        vol_bps: u16,
    }

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

    // =====================================================================
    // Construction
    // =====================================================================

    /// Initialize a new vault. Caller must already hold:
    ///   - `treasury_cap`: the `TreasuryCap<PF_SHARE>` minted by `pf_share::init`.
    ///   - `manager_id`: the ID of a `PredictManager` the operator owns and will
    ///     route hedge positions through.
    ///
    /// Returns the `AdminCap` to the caller; the vault itself is shared.
    public fun new<Quote>(
        treasury: TreasuryCap<PF_SHARE>,
        manager_id: ID,
        capacity_raw: u64,
        perf_fee_bps: u16,
        mgmt_fee_bps_yr: u16,
        hedge_sigma_bps: u16,
        hedge_vol_bps: u16,
        clock: &Clock,
        ctx: &mut TxContext,
    ): AdminCap {
        assert!(perf_fee_bps as u64 <= BPS_DENOM, EInvalidFeeBps);
        assert!(mgmt_fee_bps_yr as u64 <= BPS_DENOM, EInvalidFeeBps);
        assert!(hedge_sigma_bps > 0 && hedge_vol_bps > 0, EInvalidHedgeParams);

        let id = object::new(ctx);
        let vault_id = id.to_inner();
        let vault = Vault<Quote> {
            id,
            idle: balance::zero(),
            plp_balance: balance::zero(),
            plp_mark_q64: 0,
            plp_mark_ms: 0,
            deployed_principal: 0,
            treasury,
            manager_id,
            capacity_raw,
            paused: false,
            perf_fee_bps,
            mgmt_fee_bps_yr,
            accrued_perf: balance::zero(),
            accrued_mgmt: balance::zero(),
            last_mgmt_ms: clock.timestamp_ms(),
            perf_watermark_q64: Q64,
            hedge_sigma_bps,
            hedge_vol_bps,
        };
        transfer::share_object(vault);

        event::emit(VaultCreated { vault_id, manager_id, capacity_raw });
        AdminCap { id: object::new(ctx), vault_id }
    }

    // =====================================================================
    // Read-only views
    // =====================================================================

    /// Total NAV of the vault in quote raw units. NAV is the sum of
    ///   - idle quote held by the vault
    ///   - quote deployed into the manager
    ///   - PLP holdings valued at the operator mark
    ///
    /// Accrued fees are NOT subtracted here: `accrue_fees` already splits them
    /// out of `idle` into separate escrow balances, so they left NAV at accrual
    /// time. Subtracting them again would double-charge LPs.
    ///
    /// The signed `manager` arg is purely defensive — we don't read from it today,
    /// but the parameter exists so callers must pass a consistent manager.
    public fun nav<Quote>(vault: &Vault<Quote>, manager: &PredictManager): u64 {
        assert_manager(vault, manager);
        nav_gross(vault)
    }

    public fun share_price_q64<Quote>(vault: &Vault<Quote>, manager: &PredictManager): u128 {
        assert_manager(vault, manager);
        share_price_q64_internal(vault)
    }

    public fun idle<Quote>(vault: &Vault<Quote>): u64 { vault.idle.value() }

    public fun plp_balance<Quote>(vault: &Vault<Quote>): u64 { vault.plp_balance.value() }

    /// Quote value of the vault's PLP holdings at the current mark.
    public fun plp_value<Quote>(vault: &Vault<Quote>): u64 { plp_value_at_mark(vault) }

    public fun plp_mark_q64<Quote>(vault: &Vault<Quote>): u128 { vault.plp_mark_q64 }

    public fun plp_mark_ms<Quote>(vault: &Vault<Quote>): u64 { vault.plp_mark_ms }

    public fun deployed_principal<Quote>(vault: &Vault<Quote>): u64 { vault.deployed_principal }

    public fun manager_id<Quote>(vault: &Vault<Quote>): ID { vault.manager_id }

    public fun capacity<Quote>(vault: &Vault<Quote>): u64 { vault.capacity_raw }

    public fun is_paused<Quote>(vault: &Vault<Quote>): bool { vault.paused }

    public fun total_shares<Quote>(vault: &Vault<Quote>): u64 {
        coin::total_supply(&vault.treasury)
    }

    public fun accrued_perf_fee<Quote>(vault: &Vault<Quote>): u64 { vault.accrued_perf.value() }

    public fun accrued_mgmt_fee<Quote>(vault: &Vault<Quote>): u64 { vault.accrued_mgmt.value() }

    public fun perf_fee_bps<Quote>(vault: &Vault<Quote>): u16 { vault.perf_fee_bps }

    public fun mgmt_fee_bps_yr<Quote>(vault: &Vault<Quote>): u16 { vault.mgmt_fee_bps_yr }

    public fun hedge_sigma_bps<Quote>(vault: &Vault<Quote>): u16 { vault.hedge_sigma_bps }

    public fun hedge_vol_bps<Quote>(vault: &Vault<Quote>): u16 { vault.hedge_vol_bps }

    // =====================================================================
    // LP entry points (no AdminCap)
    // =====================================================================

    /// Deposit quote → receive `Coin<PF_SHARE>` priced at current NAV/share.
    public fun deposit<Quote>(
        vault: &mut Vault<Quote>,
        manager: &PredictManager,
        payment: Coin<Quote>,
        ctx: &mut TxContext,
    ): Coin<PF_SHARE> {
        assert!(!vault.paused, EPaused);
        let amount = payment.value();
        assert!(amount > 0, EZeroAmount);

        let nav_before = nav(vault, manager);
        assert!(nav_before + amount <= vault.capacity_raw, ECapacityExceeded);

        let total_before = coin::total_supply(&vault.treasury);
        let shares_out = compute_shares_out(amount, nav_before, total_before);

        let share_price = share_price_q64(vault, manager);
        vault.idle.join(payment.into_balance());
        let shares = coin::mint(&mut vault.treasury, shares_out, ctx);

        event::emit(Deposited {
            vault_id: vault.id.to_inner(),
            lp: ctx.sender(),
            quote_in: amount,
            shares_out,
            share_price_q64: share_price,
        });
        shares
    }

    /// Burn shares → receive proportional quote out of the vault's idle balance.
    /// Aborts if idle is insufficient — operator must reclaim from manager first.
    public fun withdraw<Quote>(
        vault: &mut Vault<Quote>,
        manager: &PredictManager,
        shares: Coin<PF_SHARE>,
        ctx: &mut TxContext,
    ): Coin<Quote> {
        let shares_in = shares.value();
        assert!(shares_in > 0, EZeroAmount);
        let total_before = coin::total_supply(&vault.treasury);
        assert!(shares_in <= total_before, EInsufficientShares);

        let nav_before = nav(vault, manager);
        assert!(nav_before > 0, EZeroNav);
        let quote_out = compute_quote_out(shares_in, nav_before, total_before);
        assert!(quote_out <= vault.idle.value(), EInsufficientIdle);

        let share_price = share_price_q64(vault, manager);
        coin::burn(&mut vault.treasury, shares);

        event::emit(Withdrawn {
            vault_id: vault.id.to_inner(),
            lp: ctx.sender(),
            shares_in,
            quote_out,
            share_price_q64: share_price,
        });
        coin::take(&mut vault.idle, quote_out, ctx)
    }

    // =====================================================================
    // Operator entry points (AdminCap required)
    // =====================================================================

    /// Move quote from the vault's idle balance into the manager so it can be
    /// supplied to PLP or used to mint hedges. The operator's signature must
    /// match the manager's owner — `predict_manager::deposit` asserts that.
    public fun deploy_idle<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        manager: &mut PredictManager,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        assert_manager(vault, manager);
        assert!(!vault.paused, EPaused);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= vault.idle.value(), EInsufficientIdle);

        let coin: Coin<Quote> = coin::take(&mut vault.idle, amount, ctx);
        predict_manager::deposit(manager, coin, ctx);
        vault.deployed_principal = vault.deployed_principal + amount;

        event::emit(CapitalDeployed { vault_id: vault.id.to_inner(), amount });
    }

    /// Pull quote back out of the manager into the vault's idle balance.
    public fun reclaim_idle<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        manager: &mut PredictManager,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        assert_manager(vault, manager);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= vault.deployed_principal, EInsufficientIdle);

        let coin = predict_manager::withdraw<Quote>(manager, amount, ctx);
        vault.idle.join(coin.into_balance());
        vault.deployed_principal = vault.deployed_principal - amount;

        event::emit(CapitalReclaimed { vault_id: vault.id.to_inner(), amount });
    }

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

    /// Mint an OTM-binary hedge wing into the vault's manager. The keeper chooses
    /// strike, side, and quantity off-chain using `hedge_policy::annual_hedge_bps`
    /// to size the wing for current utilization.
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
    ) {
        assert_admin(vault, cap);
        assert_manager(vault, manager);
        assert!(!vault.paused, EPaused);
        assert!(quantity > 0, EZeroAmount);

        let oracle_id = object::id(oracle);
        let strike = key.strike();
        let is_up = key.is_up();
        predict::mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx);

        event::emit(HedgeMinted {
            vault_id: vault.id.to_inner(),
            oracle_id,
            strike,
            is_up,
            quantity,
        });
    }

    /// Redeem a hedge wing after expiry. Payouts land in the manager's quote
    /// balance; the operator can subsequently `reclaim_idle` to move them back
    /// to the vault's idle balance for distribution.
    public fun redeem_hedge_wing<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        predict: &mut Predict,
        manager: &mut PredictManager,
        oracle: &OracleSVI,
        key: MarketKey,
        quantity: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        assert_manager(vault, manager);
        assert!(quantity > 0, EZeroAmount);

        let oracle_id = object::id(oracle);
        let strike = key.strike();
        let is_up = key.is_up();
        predict::redeem<Quote>(predict, manager, oracle, key, quantity, clock, ctx);

        event::emit(HedgeRedeemed {
            vault_id: vault.id.to_inner(),
            oracle_id,
            strike,
            is_up,
            quantity,
        });
    }

    public fun pause<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap) {
        assert_admin(vault, cap);
        vault.paused = true;
        event::emit(Paused { vault_id: vault.id.to_inner() });
    }

    public fun unpause<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap) {
        assert_admin(vault, cap);
        vault.paused = false;
        event::emit(Unpaused { vault_id: vault.id.to_inner() });
    }

    public fun set_capacity<Quote>(vault: &mut Vault<Quote>, cap: &AdminCap, new_cap: u64) {
        assert_admin(vault, cap);
        vault.capacity_raw = new_cap;
        event::emit(CapacityChanged { vault_id: vault.id.to_inner(), new_cap });
    }

    public fun set_hedge_params<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        sigma_bps: u16,
        vol_bps: u16,
    ) {
        assert_admin(vault, cap);
        assert!(sigma_bps > 0 && vol_bps > 0, EInvalidHedgeParams);
        vault.hedge_sigma_bps = sigma_bps;
        vault.hedge_vol_bps = vol_bps;
        event::emit(HedgeParamsChanged { vault_id: vault.id.to_inner(), sigma_bps, vol_bps });
    }

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

    /// Accrue the management fee for the elapsed period since the last accrual.
    /// Crystallizes performance fee if share price has advanced above the
    /// watermark. Both fee balances are skimmed off NAV — they don't reduce idle
    /// directly; they sit in escrow until `claim_fees` is called.
    public fun accrue_fees<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        manager: &PredictManager,
        clock: &Clock,
    ) {
        assert_admin(vault, cap);
        assert_manager(vault, manager);
        accrue_fees_internal(vault, clock);
    }

    fun accrue_fees_internal<Quote>(vault: &mut Vault<Quote>, clock: &Clock) {
        let now = clock.timestamp_ms();
        let elapsed = if (now > vault.last_mgmt_ms) now - vault.last_mgmt_ms else 0;
        let nav_now = nav_gross(vault);

        let mgmt_delta =
            (nav_now as u128)
        * (vault.mgmt_fee_bps_yr as u128)
        * (elapsed as u128)
        / (BPS_DENOM as u128)
        / (MS_PER_YEAR as u128);
        let mgmt_delta_u64 = if (mgmt_delta > (vault.idle.value() as u128)) {
            vault.idle.value()
        } else {
            mgmt_delta as u64
        };
        if (mgmt_delta_u64 > 0) {
            let chunk = vault.idle.split(mgmt_delta_u64);
            vault.accrued_mgmt.join(chunk);
        };

        let share_price = share_price_q64_internal(vault);
        let perf_delta_u64 = if (share_price > vault.perf_watermark_q64) {
            let total_shares = coin::total_supply(&vault.treasury);
            let gain_q64 = share_price - vault.perf_watermark_q64;
            let gross_gain = (gain_q64 * (total_shares as u128) / Q64) as u64;
            let perf =
                ((gross_gain as u128) * (vault.perf_fee_bps as u128) / (BPS_DENOM as u128)) as u64;
            if (perf > vault.idle.value()) vault.idle.value() else perf
        } else 0;
        if (perf_delta_u64 > 0) {
            let chunk = vault.idle.split(perf_delta_u64);
            vault.accrued_perf.join(chunk);
            vault.perf_watermark_q64 = share_price;
        };

        vault.last_mgmt_ms = now;
        event::emit(FeesAccrued {
            vault_id: vault.id.to_inner(),
            mgmt_delta: mgmt_delta_u64,
            perf_delta: perf_delta_u64,
        });
    }

    public fun claim_fees<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert_admin(vault, cap);
        let mgmt = vault.accrued_mgmt.value();
        let perf = vault.accrued_perf.value();
        if (mgmt > 0) {
            let c: Coin<Quote> = coin::take(&mut vault.accrued_mgmt, mgmt, ctx);
            transfer::public_transfer(c, to);
        };
        if (perf > 0) {
            let c: Coin<Quote> = coin::take(&mut vault.accrued_perf, perf, ctx);
            transfer::public_transfer(c, to);
        };
        event::emit(FeesClaimed { vault_id: vault.id.to_inner(), mgmt, perf, to });
    }

    /// Reset the performance-fee watermark. Useful if the vault has had a
    /// drawdown and the operator wants to forgo perf fees until LPs recover.
    public fun reset_perf_watermark<Quote>(
        vault: &mut Vault<Quote>,
        cap: &AdminCap,
        new_watermark_q64: u128,
    ) {
        assert_admin(vault, cap);
        assert!(new_watermark_q64 <= vault.perf_watermark_q64, EInvalidWatermark);
        vault.perf_watermark_q64 = new_watermark_q64;
    }

    // =====================================================================
    // Private helpers
    // =====================================================================

    fun assert_admin<Quote>(vault: &Vault<Quote>, cap: &AdminCap) {
        assert!(cap.vault_id == vault.id.to_inner(), ENotAdmin);
    }

    fun assert_manager<Quote>(vault: &Vault<Quote>, manager: &PredictManager) {
        assert!(object::id(manager) == vault.manager_id, EWrongManager);
    }

    fun compute_shares_out(quote_in: u64, nav_before: u64, total_before: u64): u64 {
        if (total_before == 0 || nav_before == 0) {
            quote_in
        } else {
            ((quote_in as u128) * (total_before as u128) / (nav_before as u128)) as u64
        }
    }

    fun compute_quote_out(shares_in: u64, nav_before: u64, total_before: u64): u64 {
        ((shares_in as u128) * (nav_before as u128) / (total_before as u128)) as u64
    }

    /// Quote value of the vault's PLP holdings at the current mark.
    /// A zero mark values PLP at zero — `supply_idle_to_plp` always sets the
    /// mark from its execution price, so a held-but-unmarked balance can only
    /// occur if state was constructed by hand in tests.
    fun plp_value_at_mark<Quote>(vault: &Vault<Quote>): u64 {
        ((vault.plp_balance.value() as u128) * vault.plp_mark_q64 / Q64) as u64
    }

    fun nav_gross<Quote>(vault: &Vault<Quote>): u64 {
        vault.idle.value() + vault.deployed_principal + plp_value_at_mark(vault)
    }

    fun share_price_q64_internal<Quote>(vault: &Vault<Quote>): u128 {
        let total = coin::total_supply(&vault.treasury);
        if (total == 0) Q64 else (nav_gross(vault) as u128) * Q64 / (total as u128)
    }

    fun record_plp_mark<Quote>(vault: &mut Vault<Quote>, mark_q64: u128, clock: &Clock) {
        vault.plp_mark_q64 = mark_q64;
        vault.plp_mark_ms = clock.timestamp_ms();
        event::emit(PlpMarked {
            vault_id: vault.id.to_inner(),
            mark_q64,
            timestamp_ms: vault.plp_mark_ms,
        });
    }

    // =====================================================================
    // Test-only helpers
    // =====================================================================

    #[test_only]
    public fun new_for_testing<Quote>(
        treasury: TreasuryCap<PF_SHARE>,
        manager_id: ID,
        clock: &Clock,
        ctx: &mut TxContext,
    ): AdminCap {
        new<Quote>(
            treasury,
            manager_id,
            1_000_000_000_000,
            2_000,
            100,
            200,
            8_000,
            clock,
            ctx,
        )
    }

    #[test_only]
    /// Mirror of `nav` that skips the manager check. Used by tests that exercise
    /// only the LP surface (no operator / manager interaction). Production code
    /// must always go through `nav` so the manager-id check holds.
    public fun nav_unchecked<Quote>(vault: &Vault<Quote>): u64 {
        nav_gross(vault)
    }

    #[test_only]
    public fun share_price_q64_unchecked<Quote>(vault: &Vault<Quote>): u128 {
        share_price_q64_internal(vault)
    }

    #[test_only]
    /// Mirror of `accrue_fees` that skips the cap/manager checks. The fee math
    /// itself is identical — it lives in `accrue_fees_internal`.
    public fun accrue_fees_unchecked<Quote>(vault: &mut Vault<Quote>, clock: &Clock) {
        accrue_fees_internal(vault, clock);
    }

    #[test_only]
    /// Mirror of `deposit` that skips the manager check. Used by tests that need
    /// to exercise the deposit math without standing up a real `PredictManager`.
    public fun deposit_unchecked<Quote>(
        vault: &mut Vault<Quote>,
        payment: Coin<Quote>,
        ctx: &mut TxContext,
    ): Coin<PF_SHARE> {
        assert!(!vault.paused, EPaused);
        let amount = payment.value();
        assert!(amount > 0, EZeroAmount);
        let nav_before = nav_unchecked(vault);
        assert!(nav_before + amount <= vault.capacity_raw, ECapacityExceeded);
        let total_before = coin::total_supply(&vault.treasury);
        let shares_out = compute_shares_out(amount, nav_before, total_before);
        vault.idle.join(payment.into_balance());
        coin::mint(&mut vault.treasury, shares_out, ctx)
    }

    #[test_only]
    public fun withdraw_unchecked<Quote>(
        vault: &mut Vault<Quote>,
        shares: Coin<PF_SHARE>,
        ctx: &mut TxContext,
    ): Coin<Quote> {
        let shares_in = shares.value();
        assert!(shares_in > 0, EZeroAmount);
        let total_before = coin::total_supply(&vault.treasury);
        assert!(shares_in <= total_before, EInsufficientShares);
        let nav_before = nav_unchecked(vault);
        assert!(nav_before > 0, EZeroNav);
        let quote_out = compute_quote_out(shares_in, nav_before, total_before);
        assert!(quote_out <= vault.idle.value(), EInsufficientIdle);
        coin::burn(&mut vault.treasury, shares);
        coin::take(&mut vault.idle, quote_out, ctx)
    }

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

    #[test_only]
    public(package) fun shares_out_for_testing(
        quote_in: u64,
        nav_before: u64,
        total_before: u64,
    ): u64 {
        compute_shares_out(quote_in, nav_before, total_before)
    }

    #[test_only]
    public(package) fun quote_out_for_testing(
        shares_in: u64,
        nav_before: u64,
        total_before: u64,
    ): u64 {
        compute_quote_out(shares_in, nav_before, total_before)
    }
}
