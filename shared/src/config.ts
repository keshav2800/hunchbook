/**
 * Source of truth for testnet identifiers. Pulled from the official Predict
 * source: deepbookv3-src/packages/predict/README.md and predict.move on the
 * predict-testnet-4-16 branch.
 */

export const SUI_NETWORK = "testnet" as const;
export const SUI_FULLNODE_URL = "https://fullnode.testnet.sui.io:443";

export const PREDICT_INDEXER_URL =
  "https://predict-server.testnet.mystenlabs.com";

export const PREDICT_PACKAGE_ID =
  "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";

export const PREDICT_OBJECT_ID =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";

export const DUSDC_COIN_TYPE =
  "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";

export const SUI_CLOCK_OBJECT_ID = "0x6";

export const PREDICT_MODULE = "predict";
export const PREDICT_MANAGER_MODULE = "predict_manager";
export const MARKET_KEY_MODULE = "market_key";
export const RANGE_KEY_MODULE = "range_key";

// Hunchbook router — our package wrapping mint/redeem with 1% fees.
// Published 2026-06-01 via tx AHZcBpFYSawXqix6rCJh6k2sfxSzRV4jAN7KbnTWZbEb.
export const ROUTER_PACKAGE_ID =
  "0xfdbe759a0f158926ca16de7a5f5a704c24c7dc59b23cc310259635140095297a";
export const ROUTER_MODULE = "router";

// Treasury wallet where router fees accrue. Immutable in the router source.
export const FEE_RECIPIENT_ADDRESS =
  "0x7ceebdaeab0ba4a02ed5cd7775a6e73f29748c55fd94bfd650aee277543ab1a7";

export const FEE_BPS = 100n; // 1% = 100 / 10000

// Hunchbook vault — the PLP+hedge LP vault (mark-based PLP valuation).
// v2 published 2026-06-11 (v1 0xf44c… had a fee double-count in nav; funds
// recovered and instance abandoned).
export const VAULT_PACKAGE_ID =
  "0xc84b3a1c2f010f91f80301c9ad4e366d30edcf02e832d83d5e02bf555c028af3";
export const VAULT_MODULE = "vault";
/// Shared Vault<DUSDC> instance (capacity 100k dUSDC, 20% perf / 1% mgmt).
export const VAULT_OBJECT_ID =
  "0xe7305dd0d2edcbdc5ab12f616899eedfe5b7000eea2eb01977ceff70da5a02c5";
/// Operator-owned. Never used by the web app — keeper/operator scripts only.
export const VAULT_ADMIN_CAP_ID =
  "0x70d519d91dcbe9502d38e99e7006d9347d4d889561c33f0f4b158d0f1e8f1475";
/// Dedicated PredictManager the vault routes hedge wings through.
export const VAULT_MANAGER_ID =
  "0xbf58ec0cefd2b307c0e12e0ef351d80116ee2a7036be40257222464562c1290d";
export const PF_SHARE_COIN_TYPE = `${VAULT_PACKAGE_ID}::pf_share::PF_SHARE`;

export const PHASE0_BUDGET_DUSDC_RAW = 5_000_000n;
export const PHASE0_DEFAULT_QUANTITY = 1_000_000n;
export const PHASE0_MIN_TIME_TO_EXPIRY_MS = 90_000;
export const PHASE0_MAX_TIME_TO_EXPIRY_MS = 30 * 60_000;
