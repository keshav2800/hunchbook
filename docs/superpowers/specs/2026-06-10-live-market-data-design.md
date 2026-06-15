# Live DeepBook Predict Market Data — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Replace mock market data in the web app with real DeepBook Predict testnet reads, served through Next.js route handlers acting as the API gateway. Read-only — no bet placement, no zkLogin (those are the next step). Vault and leaderboard screens stay on mocks.

## Context

The web UI foundation (spec `2026-06-10-web-app-foundation-design.md`) runs entirely on typed mock fetchers. Testnet reality (verified live 2026-06-10): only **BTC** oracles exist on Predict testnet-4-16; 4 active oracles with expiries ~2/9/16/23 days out; indexer provides per-oracle `latest_price` (spot + forward) and `latest_svi` (vol surface params), all u64-scaled by 1e9; tick history endpoint holds only a short rolling buffer (~1000 points ≈ 17 min); no candle history endpoint.

## Architecture: route handlers as API gateway

```
UI components → TanStack Query hooks (interfaces unchanged)
  → GET /api/markets (Next.js route handler, server-side)
    → @hunchbook/shared indexer client
      → https://predict-server.testnet.mystenlabs.com
```

Rationale: one swap point for testnet→mainnet/self-hosted indexer; server-side reuse of `@hunchbook/shared` (no CORS exposure, single SDK across bot/scripts/web); server-side caching (~5s revalidate) protects the shared Mysten indexer from demo traffic; the step-3 write path (devInspect quoting, sponsored tx, zkLogin) needs route handlers anyway. A standalone gateway service is explicitly rejected — second deploy and ops cost with no benefit at this scale.

`web/` gains a workspace dependency on `@hunchbook/shared`.

## Endpoints

- `GET /api/markets` — lists active oracles, fetches each oracle's state in parallel, returns `LiveMarket[]` (UI-shaped, includes spot, forward, expiry, SVI params, tick-buffer sparkline, session change). Cached server-side ~5s.
- Detail reads reuse the same payload; no per-oracle endpoint needed yet (4 oracles).

Indexer failure → 502 with error body → UI banner "Testnet data unavailable"; TanStack Query keeps last-good data visible.

## Pricing module (`web/src/lib/svi.ts`)

Pure functions, no I/O, ported from `backtest/backtest.py` Section 5.1:

- `sviTotalVariance(k, params)` — `w(k) = a + b(ρ(k−m) + √((k−m)² + σ²))`, params decoded from on-chain 1e9-scaled u64s with negative flags.
- `binaryUpProbability(forward, strike, svi)` — `d2 = (ln(F/K) − w/2)/√w`, `P(UP) = N(d2)` (normal CDF via Abramowitz-Stegun approximation, no deps).
- `probabilityToOdds(p)` — payout multiplier `1/p`, with the router's 1% fee (`FEE_BPS`) applied.

UP/DOWN odds on market cards and the Strike Studio "live re-pricing" multiplier are computed client-side from the SVI params included in `/api/markets` — instant on every stepper click, no network round-trip.

Validation: one-off node sanity script checks ATM binary ≈ 0.5 and OTM asymmetry, mirroring the backtest's printed sanity values. No test framework added.

## UI changes

- **Trade page:** pair selector → expiry selector (4 active BTC oracles, labeled e.g. "BTC/USD — Jun 12"); market cards grid shows the 4 real markets with real odds; sparkline + session change derived from the indexer tick buffer; main chart replaced with the TradingView embedded widget (symbol BTCUSD, brings its own data, themed to match).
- **Strike Studio:** spot/forward and SVI from the selected oracle; strike stepper enforces real constraints ($1 tick size, $50k min strike); strike + range multipliers computed via `svi.ts`; lightweight-charts `CandleChart` replaced by the TradingView widget here too.
- **Quick Bet panel:** odds from SVI pricing; stake stays a UI input (placement is step 3).
- **Vault / Leaderboard:** untouched, still mock.
- `Market` type evolves into `LiveMarket` (oracle id, expiry, spot, forward, SVI params); mock market fetchers are deleted; `lib/api/vault.ts` and `lib/api/leaderboard.ts` remain.

## Decimals

All indexer u64 prices (spot, forward, strikes, min_strike, tick_size) are scaled by `1e9` (`PRICE_SCALE`). SVI params are 1e9-scaled with separate `*_negative` boolean flags. Conversions happen once, at the gateway boundary — the UI only ever sees floats in USD.

## Out of scope

- Bet placement, devInspect quoting, zkLogin, wallets (step 3)
- Vault/leaderboard live data
- WebSockets (10s polling is enough for the demo)
- Mainnet config
