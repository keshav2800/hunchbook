# zkLogin + Real Bet Placement — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Google sign-in via Enoki zkLogin, sponsored gas, demo dUSDC faucet, and real on-chain bet placement through the Hunchbook router on Sui testnet. Ends when: sign in with Google → get test dUSDC → place a real UP/DOWN bet on a live BTC oracle → see the explorer link.

## Context

The web app (specs `2026-06-10-web-app-foundation-design.md`, `2026-06-10-live-market-data-design.md`) shows live BTC markets with SVI-priced odds but Place Bet is a stub. The pitch headline is "no wallets, sign in with Google." Constraints discovered:

- zkLogin users start with **0 SUI** (can't pay gas) and **0 dUSDC** (testnet dUSDC comes only from Mysten's manual tally-form funding — there is no public faucet). Both must be solved in-app or the demo dies.
- `scripts/src/phase1-router-roundtrip.ts` already proves the full bet PTB on testnet: merge dUSDC → split payment → `market_key::up/down` → `router::place_bet` (1% fee to treasury).
- `@hunchbook/shared` has all tx builders (`buildCreateManagerTx`, `addMarketKeyUp/Down`, `addRangeKey`, `addPlaceBetCall`) and `listManagersForOwner`.

## Approach decision

**Enoki (Mysten's managed zkLogin) over DIY zkLogin.** Enoki handles ephemeral keys, nonce, salt service, and the ZK prover behind `@mysten/enoki` + the Enoki Portal, and provides sponsored transactions (gas station). DIY zkLogin (`@mysten/sui/zklogin`) means running salt + prover plumbing ourselves for no demo-visible gain. Decided with user 2026-06-10.

JWT mechanics for the record: browser generates an ephemeral keypair whose pubkey is baked into the OAuth nonce → Google returns a JWT embedding that nonce → address derives from (iss, aud, sub, salt) → a ZK proof attests JWT validity without revealing it → transactions are signed with ephemeral key + proof. Enoki manages all of it.

## Components

### 1. Auth
- New deps in `web/`: `@mysten/dapp-kit`, `@mysten/enoki`, `@mysten/sui`.
- Providers: `SuiClientProvider` (testnet) + `WalletProvider` wrapping the app (existing TanStack `QueryClientProvider` satisfies dapp-kit's requirement); `registerEnokiWallets` with the public Enoki API key + Google client ID.
- Top bar: "Sign in with Google" button (replaces stub) → connects the Enoki wallet; connected state shows truncated zkLogin address + disconnect dropdown. State via `useCurrentAccount`.

### 2. Bet placement (client-built PTB, mirrors phase1)
- Quick Bet (UP/DOWN at ATM strike) and Strike Studio (custom-strike UP/DOWN; range bets stay quote-only — verified 2026-06-10 that `router::place_bet` is typed to `MarketKey`, no range entrypoint; adding `place_range_bet` to the Move package is a separate later task) build:
  merge user dUSDC coins → `splitCoins` for payment → market key → `addPlaceBetCall`.
- Strike snapped to the oracle's tick size; payment computed from the SVI-quoted probability × quantity with a small buffer, matching phase1's approach.
- Success: toast with amount + Suiscan testnet explorer link. Failure: toast with the error.

### 3. Sponsored gas
- `POST /api/sponsor` (server): Enoki **private** key; `createSponsoredTransaction` with `allowedMoveCallTargets` restricted to the router/predict/market-key targets and the sender's address.
- Client: build with `onlyTransactionKind`, send bytes to `/api/sponsor`, sign returned sponsored bytes with the Enoki wallet (`useSignTransaction`), then `POST /api/sponsor/execute` to submit via Enoki.

### 4. First-time manager setup
- Before betting, look up the user's `PredictManager` via `listManagersForOwner(address)`.
- None → sponsored `buildCreateManagerTx()` transaction first, poll the indexer for the new manager id, then proceed with the bet. Invisible to the user beyond a "Setting up your account…" state on the button.

### 5. Demo dUSDC faucet
- `POST /api/faucet` (server): signer from `TREASURY_SUI_PRIVATE_KEY` env (the tally-funded wallet) transfers 10 dUSDC to the connected address. In-memory once-per-address rate limit. Treasury pays its own gas (it has SUI).
- UI: "Get test dUSDC" button shown when the connected user's dUSDC balance is 0 (balance via `getBalance` polled with TanStack Query).

### 6. Config
`web/.env.local` (gitignored by Next.js default; never committed, never echoed):
- `NEXT_PUBLIC_ENOKI_API_KEY` (public key, zkLogin, testnet)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `ENOKI_SECRET_KEY` (private key, sponsored transactions, testnet)
- `TREASURY_SUI_PRIVATE_KEY` (bech32 `suiprivkey...` for the funded wallet)

The plan includes click-by-click Google Cloud Console + Enoki Portal setup instructions (user does these manually).

## Error handling
Toasts for: sign-in cancelled/failed, sponsorship rejected (target not allowed, quota), insufficient dUSDC (offer faucet), indexer down, tx execution failure (show digest if available). Bet button disabled while a transaction is pending.

## Out of scope
- Positions list / "My Bets", cashout/redeem flow
- Vault deposit/withdraw via zkLogin
- Range-bet placement (router has no range entrypoint — requires a Move package update; UI keeps showing quotes)
- Mainnet, production rate limiting, persistent faucet ledger

## Verification
User-driven via `pnpm web:dev` (no builds/typechecks run by Claude, per standing preference): full demo path on testnet with a real Google account, transaction visible on Suiscan, 1% fee visible at the treasury address.
