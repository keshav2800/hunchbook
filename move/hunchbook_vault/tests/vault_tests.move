#[test_only]
module hunchbook_vault::vault_tests {
    use deepbook_predict::plp::PLP;
    use hunchbook_vault::{pf_share::PF_SHARE, vault::{Self, Vault, AdminCap}};
    use std::unit_test::{assert_eq, destroy};
    use sui::{clock::{Self, Clock}, coin, sui::SUI, test_scenario::{Self as ts, Scenario}};

    const ADMIN: address = @0xAD;
    const ALICE: address = @0xA11CE;
    const BOB: address = @0xB0B;

    const QUOTE_1K: u64 = 1_000_000_000;

    fun setup(scenario: &mut Scenario): (Clock, AdminCap) {
        let manager_id = object::id_from_address(@0xFA15);
        let clock = clock::create_for_testing(scenario.ctx());
        let treasury = coin::create_treasury_cap_for_testing<PF_SHARE>(scenario.ctx());
        let cap = vault::new_for_testing<SUI>(treasury, manager_id, &clock, scenario.ctx());
        (clock, cap)
    }

    // =====================================================================
    // Pure share math
    // =====================================================================

    #[test]
    fun share_math_zero_supply_mints_one_to_one() {
        assert_eq!(vault::shares_out_for_testing(1_000, 0, 0), 1_000);
    }

    #[test]
    fun share_math_zero_nav_mints_one_to_one() {
        assert_eq!(vault::shares_out_for_testing(500, 0, 1_000), 500);
    }

    #[test]
    fun share_math_doubled_nav_halves_share_count() {
        assert_eq!(vault::shares_out_for_testing(1_000, 2_000, 1_000), 500);
    }

    #[test]
    fun share_math_quote_out_round_trips_at_genesis() {
        let shares = vault::shares_out_for_testing(1_000, 0, 0);
        let quote_back = vault::quote_out_for_testing(shares, 1_000, shares);
        assert_eq!(quote_back, 1_000);
    }

    #[test]
    fun share_math_three_lps_equal_deposits_get_equal_shares() {
        let s1 = vault::shares_out_for_testing(500, 0, 0);
        let s2 = vault::shares_out_for_testing(500, 500, s1);
        let s3 = vault::shares_out_for_testing(500, 1_000, s1 + s2);
        assert_eq!(s1, 500);
        assert_eq!(s2, 500);
        assert_eq!(s3, 500);
    }

    // =====================================================================
    // LP deposit / withdraw flows
    // =====================================================================

    #[test]
    fun first_deposit_mints_one_to_one_and_share_price_unchanged() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            assert_eq!(vault::nav_unchecked(&vault), 0);
            assert_eq!(vault::total_shares(&vault), 0);
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            assert_eq!(shares.value(), QUOTE_1K);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K);
            destroy(shares);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

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

    #[test]
    fun second_deposit_at_same_nav_gets_proportional_shares() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);

        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let alice_pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            destroy(vault::deposit_unchecked(&mut vault, alice_pay, scenario.ctx()));
            ts::return_shared(vault);
        };

        scenario.next_tx(BOB);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let bob_pay = coin::mint_for_testing<SUI>(QUOTE_1K * 2, scenario.ctx());
            let bob_shares = vault::deposit_unchecked(&mut vault, bob_pay, scenario.ctx());
            assert_eq!(bob_shares.value(), QUOTE_1K * 2);
            assert_eq!(vault::total_shares(&vault), QUOTE_1K * 3);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K * 3);
            destroy(bob_shares);
            ts::return_shared(vault);
        };

        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun deposit_then_withdraw_full_round_trip_no_value_leak() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            let quote_back = vault::withdraw_unchecked(&mut vault, shares, scenario.ctx());
            assert_eq!(quote_back.value(), QUOTE_1K);
            assert_eq!(vault::nav_unchecked(&vault), 0);
            assert_eq!(vault::total_shares(&vault), 0);
            destroy(quote_back);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun share_price_starts_at_q64_one() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let vault = scenario.take_shared<Vault<SUI>>();
            assert_eq!(vault::share_price_q64_unchecked(&vault), 1 << 64);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    // =====================================================================
    // Pause invariants
    // =====================================================================

    #[test]
    fun pause_then_unpause_flips_flag() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            assert!(!vault::is_paused(&vault));
            vault::pause(&mut vault, &cap);
            assert!(vault::is_paused(&vault));
            vault::unpause(&mut vault, &cap);
            assert!(!vault::is_paused(&vault));
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun withdraw_while_paused_still_succeeds() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        let shares = {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            ts::return_shared(vault);
            shares
        };

        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::pause(&mut vault, &cap);
            ts::return_shared(vault);
        };

        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let out = vault::withdraw_unchecked(&mut vault, shares, scenario.ctx());
            assert_eq!(out.value(), QUOTE_1K);
            destroy(out);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    // =====================================================================
    // Admin / config setters
    // =====================================================================

    #[test]
    fun set_capacity_updates_value() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_capacity(&mut vault, &cap, 12_345);
            assert_eq!(vault::capacity(&vault), 12_345);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun set_hedge_params_updates_values() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_hedge_params(&mut vault, &cap, 250, 9_500);
            assert_eq!(vault::hedge_sigma_bps(&vault), 250);
            assert_eq!(vault::hedge_vol_bps(&vault), 9_500);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    // =====================================================================
    // Expected-failure paths (one per error code touchable from tests)
    // =====================================================================

    #[test, expected_failure(abort_code = vault::EPaused)]
    fun deposit_while_paused_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::pause(&mut vault, &_cap);
            ts::return_shared(vault);
        };
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            destroy(shares);
            ts::return_shared(vault);
        };
        abort
    }

    #[test, expected_failure(abort_code = vault::EZeroAmount)]
    fun deposit_zero_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(0, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            destroy(shares);
            ts::return_shared(vault);
        };
        abort
    }

    #[test, expected_failure(abort_code = vault::ECapacityExceeded)]
    fun deposit_above_capacity_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_capacity(&mut vault, &_cap, QUOTE_1K);
            ts::return_shared(vault);
        };
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let pay = coin::mint_for_testing<SUI>(QUOTE_1K + 1, scenario.ctx());
            let shares = vault::deposit_unchecked(&mut vault, pay, scenario.ctx());
            destroy(shares);
            ts::return_shared(vault);
        };
        abort
    }

    #[test, expected_failure(abort_code = vault::EInsufficientShares)]
    fun withdraw_more_shares_than_outstanding_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let stray_shares = coin::mint_for_testing<PF_SHARE>(1, scenario.ctx());
            let out = vault::withdraw_unchecked(&mut vault, stray_shares, scenario.ctx());
            destroy(out);
            ts::return_shared(vault);
        };
        abort
    }

    #[test, expected_failure(abort_code = vault::EInvalidHedgeParams)]
    fun set_hedge_params_with_zero_sigma_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_hedge_params(&mut vault, &_cap, 0, 8_000);
            ts::return_shared(vault);
        };
        abort
    }

    #[test, expected_failure(abort_code = vault::ENotAdmin)]
    fun pause_with_foreign_cap_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (clock, _cap_a) = setup(&mut scenario);

        scenario.next_tx(ADMIN);
        let mid_b = object::id_from_address(@0xBEEF);
        let treasury_b = coin::create_treasury_cap_for_testing<PF_SHARE>(scenario.ctx());
        let _cap_b = vault::new_for_testing<SUI>(treasury_b, mid_b, &clock, scenario.ctx());

        scenario.next_tx(ADMIN);
        let vault_b_id = ts::most_recent_id_shared<Vault<SUI>>().destroy_some();
        {
            let mut vault_b = ts::take_shared_by_id<Vault<SUI>>(&scenario, vault_b_id);
            vault::pause(&mut vault_b, &_cap_a);
            ts::return_shared(vault_b);
        };
        abort
    }

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
                &mut vault,
                600_000_000,
                plp,
                &clock,
                scenario.ctx(),
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
                &mut vault,
                500_000_000,
                plp,
                &clock,
                scenario.ctx(),
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
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(1, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, 0, plp, &_clock, scenario.ctx());
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test, expected_failure(abort_code = vault::EInsufficientIdle)]
    fun supply_above_idle_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let plp = coin::mint_for_testing<PLP>(1, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(&mut vault, 1, plp, &_clock, scenario.ctx());
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
            vault::supply_idle_to_plp_for_testing(
                &mut vault,
                QUOTE_1K,
                plp,
                &clock,
                scenario.ctx(),
            );
            // keeper marks +12.5% (binary-exact: 9/8) → NAV grows 12.5%
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 9 / 8, &clock);
            assert_eq!(vault::plp_value(&vault), QUOTE_1K * 9 / 8);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K * 9 / 8);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test, expected_failure(abort_code = vault::EMarkDrift)]
    fun keeper_mark_beyond_drift_bound_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &_cap, Q64_TEST, &_clock); // first set: free
            vault::set_plp_mark(&mut vault, &_cap, Q64_TEST * 13 / 10, &_clock); // +30% → abort
            ts::return_shared(vault);
        };
        abort 999
    }

    #[test, expected_failure(abort_code = vault::EZeroMark)]
    fun keeper_mark_zero_aborts() {
        let mut scenario = ts::begin(ADMIN);
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &_cap, 0, &_clock);
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
            vault::supply_idle_to_plp_for_testing(
                &mut vault,
                QUOTE_1K,
                plp,
                &clock,
                scenario.ctx(),
            );
            assert_eq!(vault::idle(&vault), 0);

            // pool appreciated 5%: redeeming all PLP returns 1050
            let quote_back = coin::mint_for_testing<SUI>(QUOTE_1K + 50_000_000, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(
                &mut vault,
                QUOTE_1K,
                quote_back,
                &clock,
                scenario.ctx(),
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
        let (_clock, _cap) = setup(&mut scenario);
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let quote_back = coin::mint_for_testing<SUI>(1, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(
                &mut vault,
                1,
                quote_back,
                &_clock,
                scenario.ctx(),
            );
            ts::return_shared(vault);
        };
        abort 999
    }

    // =====================================================================
    // Fee accrual (regression: accrued fees must not be double-subtracted)
    // =====================================================================

    const MS_PER_YEAR_TEST: u64 = 365 * 24 * 60 * 60 * 1_000;

    #[test]
    fun mgmt_fee_accrual_drops_nav_by_exactly_the_fee_once() {
        let mut scenario = ts::begin(ADMIN);
        let (mut clock, cap) = setup(&mut scenario);
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
            clock.increment_for_testing(MS_PER_YEAR_TEST);
            vault::accrue_fees_unchecked(&mut vault, &clock);
            // 1% mgmt fee per year on 1k NAV = 10
            assert_eq!(vault::accrued_mgmt_fee(&vault), 10_000_000);
            assert_eq!(vault::accrued_perf_fee(&vault), 0);
            // NAV drops by exactly the fee — NOT twice the fee
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K - 10_000_000);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun perf_fee_crystallizes_once_on_mark_gain_and_respects_watermark() {
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
            // supply half at par, then PLP appreciates 12.5% → NAV 1062.5, price 1.0625
            let plp = coin::mint_for_testing<PLP>(500_000_000, scenario.ctx());
            vault::supply_idle_to_plp_for_testing(
                &mut vault,
                500_000_000,
                plp,
                &clock,
                scenario.ctx(),
            );
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 9 / 8, &clock);
            assert_eq!(vault::nav_unchecked(&vault), 1_062_500_000);

            // elapsed 0 → mgmt 0; perf = 20% of the 62.5 gain above watermark = 12.5
            vault::accrue_fees_unchecked(&mut vault, &clock);
            assert_eq!(vault::accrued_mgmt_fee(&vault), 0);
            assert_eq!(vault::accrued_perf_fee(&vault), 12_500_000);
            assert_eq!(vault::nav_unchecked(&vault), 1_050_000_000);

            // watermark moved up — accruing again charges nothing
            vault::accrue_fees_unchecked(&mut vault, &clock);
            assert_eq!(vault::accrued_perf_fee(&vault), 12_500_000);
            assert_eq!(vault::nav_unchecked(&vault), 1_050_000_000);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
    }

    #[test]
    fun claim_fees_pays_operator_without_touching_nav() {
        let mut scenario = ts::begin(ADMIN);
        let (mut clock, cap) = setup(&mut scenario);
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
            clock.increment_for_testing(MS_PER_YEAR_TEST);
            vault::accrue_fees_unchecked(&mut vault, &clock);
            let nav_before_claim = vault::nav_unchecked(&vault);
            vault::claim_fees(&mut vault, &cap, ADMIN, scenario.ctx());
            assert_eq!(vault::accrued_mgmt_fee(&vault), 0);
            assert_eq!(vault::nav_unchecked(&vault), nav_before_claim);
            ts::return_shared(vault);
        };
        destroy(clock);
        destroy(cap);
        scenario.end();
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
            vault::supply_idle_to_plp_for_testing(
                &mut vault,
                QUOTE_1K,
                plp,
                &clock,
                scenario.ctx(),
            );
            ts::return_shared(vault);
        };

        // 3. Keeper marks +6.25% (binary-exact: 17/16) — share price follows
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            vault::set_plp_mark(&mut vault, &cap, Q64_TEST * 17 / 16, &clock);
            assert_eq!(vault::nav_unchecked(&vault), QUOTE_1K * 17 / 16);
            ts::return_shared(vault);
        };

        // 4. Operator redeems everything at the appreciated price
        scenario.next_tx(ADMIN);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let appreciated = QUOTE_1K * 17 / 16;
            let quote_back = coin::mint_for_testing<SUI>(appreciated, scenario.ctx());
            vault::redeem_plp_to_idle_for_testing(
                &mut vault,
                QUOTE_1K,
                quote_back,
                &clock,
                scenario.ctx(),
            );
            ts::return_shared(vault);
        };

        // 5. Alice withdraws all shares and realizes the 6.25% gain
        scenario.next_tx(ALICE);
        {
            let mut vault = scenario.take_shared<Vault<SUI>>();
            let out = vault::withdraw_unchecked(&mut vault, alice_shares, scenario.ctx());
            assert_eq!(out.value(), QUOTE_1K * 17 / 16);
            assert_eq!(vault::nav_unchecked(&vault), 0);
            assert_eq!(vault::total_shares(&vault), 0);
            destroy(out);
            ts::return_shared(vault);
        };

        destroy(clock);
        destroy(cap);
        scenario.end();
    }
}
