// Hunchbook router: thin wrapper around deepbook_predict that bundles a 1%
// entry fee onto mint and a 1% exit fee onto redeem+withdraw, in a single PTB
// hop the bot/Mini-App can call. The fee recipient is hardcoded and immutable
// for the life of this package — to change it, republish.
module hunchbook_router::router;

use deepbook_predict::market_key::MarketKey;
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use sui::clock::Clock;
use sui::coin::{Self, Coin};

// Treasury wallet — generated via `sui client new-address ed25519 hunchbook-treasury`.
const FEE_RECIPIENT: address =
    @0x7ceebdaeab0ba4a02ed5cd7775a6e73f29748c55fd94bfd650aee277543ab1a7;

// Fee in basis points. 100 bps = 1%.
const FEE_BPS: u64 = 100;
const BPS_DENOM: u64 = 10000;

const E_ZERO_PAYMENT: u64 = 0;
const E_ZERO_WITHDRAW: u64 = 1;

/// Place a bet: skim 1% fee → treasury, deposit the rest into the user's
/// PredictManager, then mint the position. The mint call internally pulls the
/// exact premium from the manager's balance; any leftover dust stays in the
/// manager and is reclaimable on cashout.
public fun place_bet<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    mut payment: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let total = coin::value(&payment);
    assert!(total > 0, E_ZERO_PAYMENT);

    let fee_amount = (total * FEE_BPS) / BPS_DENOM;
    if (fee_amount > 0) {
        let fee_coin = coin::split(&mut payment, fee_amount, ctx);
        transfer::public_transfer(fee_coin, FEE_RECIPIENT);
    };

    predict_manager::deposit(manager, payment, ctx);
    predict::mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Cash out: redeem the position (payout lands in manager's internal balance),
/// withdraw the requested amount, skim 1% fee → treasury, send the rest to
/// the caller. `withdraw_amount` lets the user partially cash out — e.g.
/// redeem one winning position but leave staked principal in the manager.
public fun cashout<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    withdraw_amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(withdraw_amount > 0, E_ZERO_WITHDRAW);

    predict::redeem<Quote>(predict, manager, oracle, key, quantity, clock, ctx);

    let mut coin = predict_manager::withdraw<Quote>(manager, withdraw_amount, ctx);
    let total = coin::value(&coin);
    let fee_amount = (total * FEE_BPS) / BPS_DENOM;
    if (fee_amount > 0) {
        let fee_coin = coin::split(&mut coin, fee_amount, ctx);
        transfer::public_transfer(fee_coin, FEE_RECIPIENT);
    };

    transfer::public_transfer(coin, ctx.sender());
}
