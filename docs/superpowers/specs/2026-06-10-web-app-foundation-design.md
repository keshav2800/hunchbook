# Hunchbook Web App Foundation — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Phase C web UI — Next.js foundation + theme system + app shell + all 4 screens with mock data. No chain/DeepBook/zkLogin integration in this task.

## Context

Hunchbook (DeepBook hackathon, deadline 2026-06-19) pivoted from Telegram bot to web app as the primary surface. Phase B (vault accounting) is done; the web UI is the missing Phase C piece. Visual reference: four Stitch design screens in `/Users/keshav/Downloads/stitch/` (layout is binding; colors/theme must be swappable via central tokens).

## Stack

- **Next.js 15 (App Router) + TypeScript (strict)** — new workspace package `web/` (`@hunchbook/web`) in the existing pnpm workspace (`pnpm-workspace.yaml` gains `web`). Can later import types from `@hunchbook/shared`.
- **Tailwind CSS v4 + shadcn/ui** — owned, editable components; styled via semantic CSS variables.
- **Charts:** TradingView `lightweight-charts` for candlestick price charts (Trade + Strike Studio); `recharts` for vault NAV/drawdown area charts and market-card sparklines.
- **Data:** TanStack Query over a typed mock layer in `web/src/lib/api/*.ts`. Each screen consumes hooks (`useMarkets()`, `useVaultStats()`, …) whose implementations are mock fetchers today and real DeepBook indexer/zkLogin calls later — swap is function-body only.

## Theme system

Single source of truth: `web/src/styles/theme.css` defining semantic CSS variables:

- Core: `--background`, `--surface`, `--surface-elevated`, `--border`, `--primary`, `--accent`, `--foreground`, `--muted-foreground`
- Domain: `--positive` (UP/green), `--negative` (DOWN/red), `--warning`
- Chart palette: `--chart-1..5`, candle up/down colors
- Shape: `--radius`

shadcn components map to these via Tailwind theme config; chart configs read them via `getComputedStyle` helpers. Initial values extracted from Stitch screens: deep navy background (~`#0a1628` family), cyan/blue accent, glassy elevated card surfaces. **Changing the entire app's look = editing this one file.**

## App shell

Unified collapsible left sidebar (shadcn `Sidebar`) across all routes — resolves the Stitch inconsistency (some screens showed a top navbar). Top bar contains page title and a wallet-connect button (visual stub only). Nav items: Trade, Strike Studio, Vault, Leaderboard.

## Screens (all mock data)

1. **`/` Trade** — candlestick chart with pair selector; Quick Bet panel (UP/DOWN toggle, stake input, risk preset selector, payout multiplier, win probability, Place Bet button); grid of live market cards (pair, spot price, expiry, UP/DOWN odds, sparkline).
2. **`/strike` Strike Studio** — price chart; custom strike price input with ± stepper buttons and live re-pricing payout multiplier; range bet section (lower/upper strike inputs, payout multiplier); wager amount + potential payout + Place Bet.
3. **`/vault` Vault** — stat cards (TVL/NAV, share price, user position value); historical NAV & drawdown chart with series toggle; hedge composition breakdown; Deposit/Withdraw tab panel with token amount input; vault transactions table (type, amount, date, status).
4. **`/leaderboard` Leaderboard** — streak counter with milestone tiers (3/7/14/30 days); weekly vs all-time ranking tabs; rankings table (rank, user, win rate, points/volume); notifications feed panel.

## Error/empty states

Mock layer never fails, but each screen renders sensible loading skeletons via TanStack Query state so real-API integration inherits them.

## Testing & verification

- Gates: `tsc --noEmit` (strict) + ESLint, wired as `web/` package scripts.
- Root scripts: `web:dev`, `web:build`, `web:lint`.
- Manual verification: each screen rendered and visually checked in the browser against its Stitch reference before completion.
- No component unit tests in this task (hackathon ROI).

## Out of scope

- Real DeepBook/Sui/zkLogin integration, wallet flows, websockets/live prices
- Runtime theme switcher UI (tokens are code-configurable only)
- Mobile-first optimization (desktop-first; basic responsiveness only)
