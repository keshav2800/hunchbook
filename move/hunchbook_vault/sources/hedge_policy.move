/// Stateless hedge-sizing policy. A pure step function from pool utilization
/// to an annual hedge budget, expressed in basis points.
///
/// Centralizing the policy here means the on-chain vault, the off-chain
/// keeper, and the frontend all read from the same source of truth. Update
/// the curve here and every caller picks it up.
module hunchbook_vault::hedge_policy;

const QUIET_THRESHOLD_BPS: u64 = 500;       // 5%
const NORMAL_THRESHOLD_BPS: u64 = 2000;     // 20%
const ACTIVE_THRESHOLD_BPS: u64 = 5000;     // 50%

const QUIET_HEDGE_BPS: u16 = 100;           // 1%/yr
const NORMAL_HEDGE_BPS: u16 = 300;          // 3%/yr
const ACTIVE_HEDGE_BPS: u16 = 800;          // 8%/yr
const STRESSED_HEDGE_BPS: u16 = 1500;       // 15%/yr

/// Map pool utilization (bps) to the vault's target annual hedge spend (bps).
///
/// The step function is intentionally coarse: insurance scales with risk
/// without trying to predict micro-regime changes. See backtest output —
/// dynamic sizing beats fixed strategies by ~17 bps of drawdown under stress
/// without giving up meaningful APY in calm conditions.
public fun annual_hedge_bps(utilization_bps: u64): u16 {
    if (utilization_bps < QUIET_THRESHOLD_BPS) {
        QUIET_HEDGE_BPS
    } else if (utilization_bps < NORMAL_THRESHOLD_BPS) {
        NORMAL_HEDGE_BPS
    } else if (utilization_bps < ACTIVE_THRESHOLD_BPS) {
        ACTIVE_HEDGE_BPS
    } else {
        STRESSED_HEDGE_BPS
    }
}

/// Minimum and maximum possible outputs of `annual_hedge_bps`. Exposed so
/// downstream code can sanity-check params without re-deriving the bounds.
public fun min_hedge_bps(): u16 { QUIET_HEDGE_BPS }
public fun max_hedge_bps(): u16 { STRESSED_HEDGE_BPS }

#[test_only]
public fun quiet_threshold_bps(): u64 { QUIET_THRESHOLD_BPS }
#[test_only]
public fun normal_threshold_bps(): u64 { NORMAL_THRESHOLD_BPS }
#[test_only]
public fun active_threshold_bps(): u64 { ACTIVE_THRESHOLD_BPS }

#[test_only]
module hunchbook_vault::hedge_policy_tests {
    use hunchbook_vault::hedge_policy;
    use std::unit_test::assert_eq;

    #[test]
    fun util_zero_returns_min_hedge() {
        assert_eq!(hedge_policy::annual_hedge_bps(0), 100);
    }

    #[test]
    fun util_just_below_quiet_threshold_uses_quiet_bucket() {
        assert_eq!(hedge_policy::annual_hedge_bps(499), 100);
    }

    #[test]
    fun util_at_quiet_threshold_steps_to_normal_bucket() {
        assert_eq!(hedge_policy::annual_hedge_bps(500), 300);
    }

    #[test]
    fun util_just_below_normal_threshold_stays_normal() {
        assert_eq!(hedge_policy::annual_hedge_bps(1999), 300);
    }

    #[test]
    fun util_at_normal_threshold_steps_to_active() {
        assert_eq!(hedge_policy::annual_hedge_bps(2000), 800);
    }

    #[test]
    fun util_just_below_active_threshold_stays_active() {
        assert_eq!(hedge_policy::annual_hedge_bps(4999), 800);
    }

    #[test]
    fun util_at_active_threshold_steps_to_stressed() {
        assert_eq!(hedge_policy::annual_hedge_bps(5000), 1500);
    }

    #[test]
    fun util_at_full_pool_is_stressed_max() {
        assert_eq!(hedge_policy::annual_hedge_bps(10_000), 1500);
    }

    #[test]
    fun util_above_pool_full_is_still_stressed_max() {
        assert_eq!(hedge_policy::annual_hedge_bps(50_000), 1500);
    }

    /// Coarse monotonicity check: walking through every bucket-defining
    /// utilization level, the hedge bps must not decrease.
    #[test]
    fun hedge_bps_is_monotone_non_decreasing() {
        let samples: vector<u64> = vector[0, 250, 499, 500, 1000, 1999, 2000, 3500, 4999, 5000, 7500, 10_000];
        let n = samples.length();
        let mut prev = hedge_policy::annual_hedge_bps(samples[0]);
        let mut i = 1;
        while (i < n) {
            let curr = hedge_policy::annual_hedge_bps(samples[i]);
            assert!(curr >= prev);
            prev = curr;
            i = i + 1;
        };
    }

    #[test]
    fun bounds_match_step_function() {
        assert_eq!(hedge_policy::min_hedge_bps(), hedge_policy::annual_hedge_bps(0));
        assert_eq!(hedge_policy::max_hedge_bps(), hedge_policy::annual_hedge_bps(9999));
    }
}
