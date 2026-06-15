/// The vault's share token. Holders own a proportional claim on vault NAV.
///
/// `init` creates the currency and ships the `TreasuryCap` to the publisher.
/// The publisher then passes that cap into `vault::new`, where it is moved
/// into the `Vault` object and used to mint shares on deposit / burn shares
/// on withdraw.
module hunchbook_vault::pf_share;

use sui::coin_registry;

/// One-time witness for the share `Coin`.
public struct PF_SHARE has drop {}

fun init(witness: PF_SHARE, ctx: &mut TxContext) {
    let (builder, treasury_cap) = coin_registry::new_currency_with_otw(
        witness,
        6,
        b"PFSHARE".to_string(),
        b"Hunchbook Vault Share".to_string(),
        b"Share token representing a claim on the Hunchbook vault NAV.".to_string(),
        b"".to_string(),
        ctx,
    );

    let metadata_cap = builder.finalize(ctx);

    transfer::public_transfer(treasury_cap, ctx.sender());
    transfer::public_transfer(metadata_cap, ctx.sender());
}
