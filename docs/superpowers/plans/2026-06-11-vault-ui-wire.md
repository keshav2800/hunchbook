# Vault Page → Live Contract Implementation Plan

> Executed inline 2026-06-11 (same session as contract deploy). Compact plan — full design
> discussed and approved in-session.

**Goal:** Replace mocked vault data with the deployed Vault `0xe730…02c5` (package `0xc84b…8af3`):
real TVL/share-price/position reads, event-replay NAV history, sponsored deposit/withdraw.

**Pre-req found in review:** sponsor route allowlists move-call targets — `vault::deposit` and
`vault::withdraw` must be added or every zkLogin deposit fails at sponsorship.

**Contract fix shipped first (same session):** `nav` subtracted accrued-fee escrow on top of the
`idle.split` that already removed it — LPs double-charged on every accrual. Fixed (`nav_gross`),
3 regression tests added (45/45 green), redeployed, funds migrated from the v1 instance.

## Tasks

1. **Types** — `VaultStats` becomes: `tvlUsd, sharePrice, sharePriceChangePct: number|null,
   apyPct: number|null, userPositionUsd: number|null, userShares: number|null,
   composition: {label,pct}[], history: {date,nav,drawdownPct}[]`. `VaultTransaction` becomes
   on-chain shape: `{digest, type: 'Deposit'|'Withdraw', amountUsd, lp, timestampMs}`.
2. **`/api/vault` route** — one GET: reads vault object fields (idle, plp_balance, plp_mark_q64,
   deployed_principal, treasury.total_supply); NAV = idle + deployed + plp×mark (mirrors fixed
   contract); share price = NAV/shares (1.0 when no shares); composition from same fields;
   history by replaying vault-module events (Deposited/Withdrawn/CapitalDeployed/
   CapitalReclaimed/PlpSupplied/PlpRedeemed/PlpMarked — FeesAccrued reduces idle) ascending with
   a NAV+share-price snapshot per event + live tail point; drawdown = % below running share-price
   peak; APY = annualized share-price growth, null when history spans < 24h; `owner` param adds
   PFSHARE balance → position. 30s module-level TTL cache (pattern from /api/history).
   `recentTransactions` (Deposited/Withdrawn, newest 20) in the same payload.
3. **Chain builders** (`lib/chain.ts`) — `buildVaultDepositTx` (merge dUSDC → split → deposit →
   transfer shares to sender), `buildVaultWithdrawTx` (merge PFSHARE → split shares → withdraw →
   transfer quote), `getPfShareBalanceRaw`.
4. **Mutations** (`lib/use-vault.ts`) — `useVaultStats(owner)`, `useVaultDeposit`,
   `useVaultWithdraw` via the exported sponsored executor; friendly abort mapping
   (capacity=4, paused=2, idle=6, zero-nav=5); invalidate `['vault']`+`['dusdc-balance']`.
   `useSponsoredExecutor` becomes exported from use-place-bet.
5. **Sponsor allowlist** — add `${VAULT_PACKAGE_ID}::vault::deposit|withdraw`.
6. **UI** — `deposit-withdraw.tsx` rebuilt (dUSDC-only, balance + Max, pending, signed-out
   prompt); vault page consumes real stats (APY null → "targeting 8–15% · variable"),
   composition = USDC Buffer / DeepBook PLP / Hedge (manager), tx table gets LP + Suiscan
   columns; old mock `lib/api/vault.ts` deleted, `useVaultStats`/`useVaultTransactions` removed
   from `lib/hooks.ts`.
7. **Verify** — tsc (es2020 override) + eslint on changed files; browser hand-off.
