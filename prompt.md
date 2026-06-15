# Claude Code Build Prompt — "Hunchbook"
### A Telegram-native social prediction app on Sui DeepBook Predict

Copy everything below the line into Claude Code as your opening prompt. It is written to be handed to an agent that will build, run, and test on Sui testnet.

---

## 0. What you are building (read this first)

A **Telegram-native** product on Sui where users bet on short-term **Bitcoin price** moves using **DeepBook Predict**. There are **two surfaces of one product**, and they share the same on-chain contracts:

1. **Telegram Bot (chat)** — a user types a bet in plain text (e.g. `up 70k 15m 100`) and it places the bet, then DMs them when it settles. They can also share a bet into a group.
2. **Telegram Mini App (webview)** — an Instagram-style **vertical, swipeable feed** of live BTC markets. Tap YES/NO to bet, see a live activity strip ("the crowd"), a leaderboard, and a daily streak.

**The business model is a fee on every bet AND every cashout.** Every bet is routed through *our own* thin Move contract, which:
1. **On bet placement:** skims a configurable fee (default **1%**) from the stake into a treasury, then calls DeepBook Predict `mint` with the remainder.
2. **On winning cashout / redeem:** skims a configurable fee (default **1%**) from the payout into the treasury before sending the rest to the user.

Both fee legs are independently configurable (`entry_fee_bps`, `exit_fee_bps`) and owner-adjustable. This double-sided fee layer is the most important part of the product — never bypass it on either leg. Losing bets never reach redeem, so they only pay the entry fee — that is expected.

### Hard constraints — do not violate
- **Whatever DeepBook Predict supports.** Do **not** hardcode BTC. At startup the bot/Mini App must read the live list of markets exposed by the Predict indexer/registry and surface *all* of them — whichever underlyings (BTC, ETH, SUI, etc.) and expiries Predict currently lists on testnet. The market universe is whatever the protocol gives us; if Predict adds a new pair, our UI must pick it up without a code change. Do **not** try to build culture/sports/event markets — Predict cannot resolve those.
- **Testnet only.** The quote asset is **dUSDC** (testnet play-money, not real USDC). Never touch mainnet or real funds.
- **The fee router is mandatory on BOTH legs.** All mints AND all redeems flow through our contract so the entry fee and exit fee are always collected.

---

## 1. Tech stack (use exactly this unless something is impossible)

- **Smart contracts:** Sui Move.
- **Bot:** Node.js + TypeScript + **grammY** (Telegram bot framework with first-class Mini App support).
- **Mini App:** React + TypeScript + **@telegram-apps/sdk-react** (official Telegram Mini Apps SDK). Do **not** use Vite. Mobile-first, full-screen, vertical-scroll.
- **Sui SDK:** **@mysten/sui**.
- **Auth + gas:** **@mysten/enoki** for **zkLogin with Google** (so users sign in with Google, no seed phrase) and **Enoki-sponsored transactions** (so users need no SUI for gas). This is the "normie onboarding" layer — make it work, it is a key differentiator.
- **Backend / indexer reader:** a small **Fastify** server (TypeScript) that reads the public Predict indexer and serves market data, odds, activity, and leaderboard to the Mini App. May be folded into the bot process if simpler.
- **Repo layout:** pnpm workspace monorepo:
  ```
  /contracts     Move package (fee router + treasury)
  /bot           grammY Telegram bot
  /miniapp       React + Vite Telegram Mini App
  /server        Fastify API + indexer reader
  /shared        shared TS types, config (package IDs, object IDs)
  /scripts       phase-0 integration test scripts
  ```

---

## 2. CRITICAL — verify the real DeepBook Predict interface before writing any integration code

Do **not** guess function signatures, object IDs, or the dUSDC coin type. Before Phase 1, clone and read the actual protocol source:

- **Repo:** https://github.com/MystenLabs/deepbookv3 — use branch **`predict-testnet-4-16`** (NOT `main`), folder `packages/predict`.
- **Predict docs:** https://docs.sui.io/onchain-finance/deepbook-predict/
- **DeepBook v3 docs:** https://docs.sui.io/onchain-finance/deepbookv3/deepbook
- **DeepBook sandbox (1-line local deploy of the stack):** https://github.com/MystenLabs/deepbook-sandbox
- **Public indexer / API:** `predict-server.testnet.mystenlabs.com`

From the source, confirm and write into `/shared/config.ts`:
- exact signatures of `predict::mint`, `predict::redeem`, `predict::redeem_permissionless`, and `predict::supply`
- the `PredictManager` type, and how a per-user manager is created/looked up
- the on-chain object IDs on testnet (package ID, registry/market objects, oracle objects)
- the exact **dUSDC** coin type
- what the indexer/API exposes for: current markets, market odds/prices, settlement events, and per-user positions

If anything differs from what this prompt assumes, trust the source code and adjust.

---

## 3. Build order — DE-RISK FIRST (do not skip Phase 0)

### Phase 0 — Prove the on-chain round trip (build NO UI yet)
Write a standalone TS script in `/scripts` that, using a funded testnet keypair:
1. ensures a `PredictManager` exists for the account (create if needed),
2. holds dUSDC,
3. successfully calls `predict::mint` on one live BTC market,
4. after that market settles, calls `predict::redeem`,
5. prints every transaction digest.

**Do not proceed to Phase 1 until this script passes end to end on testnet.** This is the single riskiest part of the project; everything else is UI on top of it.

### Phase 1 — Move fee-router contract (dual-sided fee)
Create a Move package `hunchbook`:
- A shared `FeeConfig` object with an owner, `entry_fee_bps: u64` (start at 100 = 1%), and `exit_fee_bps: u64` (start at 100 = 1%).
- A `Treasury` that accumulates the skimmed dUSDC from both legs.
- An entry function `place_bet(...)` that: takes a `Coin<dUSDC>`, splits `entry_fee_bps` into the treasury, calls `predict::mint` with the remainder plus the user's `PredictManager` and the market/direction/expiry params, and emits a `BetPlaced` event (user, market id, gross stake, entry fee, net stake, timestamp).
- An entry function `cashout(...)` that: calls `predict::redeem` (or `redeem_permissionless` as appropriate) on a settled winning position, receives the dUSDC payout coin, splits `exit_fee_bps` from the gross payout into the treasury, transfers the remainder to the user, and emits a `Cashout` event (user, market id, gross payout, exit fee, net payout, timestamp). Losing positions don't pay an exit fee because there's nothing to redeem.
- `set_entry_fee_bps`, `set_exit_fee_bps`, and `withdraw_fees` callable only by the owner.
- Match `place_bet` and `cashout` to the **real** `predict::mint` / `predict::redeem` / `predict::redeem_permissionless` signatures confirmed in Section 2.
- Write Move unit tests covering: entry fee correctness, exit fee correctness on a winning redeem, no exit fee path for losing positions, owner-only gating on setters/withdrawals.
- Write a TS deploy script. Deploy to testnet and record IDs in `/shared/config.ts`.

### Phase 2 — Telegram bot (grammY)
- Commands: `/start` (welcome + onboard, create/link a manager, link Enoki/Google identity), `/markets` (list whatever Predict currently offers — BTC, ETH, SUI, etc.), `up <symbol> <strike> <expiry> <amount>`, `down <symbol> <expiry> <amount>`, `/balance`, `/positions`, `/cashout` (redeem winning positions through our fee router).
- Parse `<symbol>` against the live market list pulled from the indexer — never hardcode BTC.
- An inline button **"Open Feed"** that launches the Mini App.
- A **settlement watcher**: poll the Predict indexer for settled markets, then DM each affected user their win/loss with the tx link. Winning DMs show a one-tap "Cash out" button that calls Phase-1 `cashout`, surfacing the exit fee before confirming.
- Group features: `/leaderboard`, and a "share this bet" button that posts a bet card to a group with a "copy this bet" deep link.
- Every bet goes through the Phase-1 `place_bet` (entry fee always collected). Every payout goes through Phase-1 `cashout` (exit fee always collected).

### Phase 3 — Mini App feed (React + TypeScript + Telegram SDK)
- Initialize `@telegram-apps/sdk-react`; adopt Telegram theme colors; verify Telegram `initData` server-side.
- **Vertical full-screen swipeable feed**, one market per card across **every underlying Predict supports** (BTC, ETH, SUI, …, whatever the indexer returns): the question (e.g. "ETH above $3.5k in 15m?"), the asset symbol/logo, live odds, a live countdown timer, big YES/NO buttons, and a **live activity strip** showing recent bets (the "crowd" feel). Optional filter chips per asset, but the default feed mixes everything live.
- **Bet sheet:** amount selector, shows the **entry fee** explicitly (e.g. "1% fee · you stake 99 dUSDC"), confirm button.
- **Positions / Cashout screen:** lists settled winners with a **Cash out** CTA that shows the **exit fee** explicitly (e.g. "Payout 150 dUSDC · 1% fee · you receive 148.5 dUSDC") before confirming. Calls Phase-1 `cashout` as a sponsored tx.
- **Auth:** Google sign-in via Enoki zkLogin → get the user's Sui address; place bets and cashouts as **Enoki-sponsored transactions** so the user needs no SUI.
- **Leaderboard** screen and a **daily streak** indicator.
- All data from the Phase-4 server API.

### Phase 4 — Server, wiring, and demo
- Fastify endpoints: `/markets`, `/market/:id`, `/activity`, `/leaderboard`, `/user/:addr/positions`. Reads the Predict indexer + on-chain state.
- Auth: validate Telegram `initData`; validate the Enoki session.
- Wire bot + Mini App + server + contract together.
- Produce a **`DEMO.md`** with the exact 90-second on-stage script (see Section 5) and a one-command local run.

---

## 4. Setup / prerequisites — include these steps and guide me through them

1. **Sui CLI + testnet:** install Sui CLI, set env to testnet, create a keypair, get testnet SUI from the faucet.
2. **dUSDC:** request testnet dUSDC via the form — https://tally.so/r/Xx102L (this is NOT the official testnet USDC).
3. **DeepBook Predict source:** clone `deepbookv3`, checkout branch `predict-testnet-4-16`, read `packages/predict`.
4. **Telegram:** create a bot with @BotFather, get the bot token, and register the Mini App URL.
5. **Enoki:** create an Enoki account, set up a Google OAuth client ID, and get an Enoki API key for zkLogin + sponsored transactions.
6. **Secrets:** put all tokens/keys in `.env` files; never commit secrets; provide a `.env.example` for each package.

If any step needs a value only I can provide (bot token, Enoki key, Google client ID, my testnet address), **stop and ask me** rather than inventing placeholders that look real.

---

## 5. Demo flow this must support (the win condition)

1. Open the Mini App, **scroll** the feed of live markets across **every asset Predict offers** (BTC, ETH, SUI, …).
2. Tap a market resolving in ~2 minutes, bet 50 dUSDC — bet sheet shows **"1% entry fee · 49.5 dUSDC into the market"** — **Google login, no seed phrase, gas sponsored**.
3. Point at the **fee treasury ticking up** from the entry fee (this is the business, leg 1).
4. The market settles in our favor; the **bot DMs** the win with a one-tap **Cash out** button.
5. Tap Cash out — sheet shows **"1% exit fee"** — confirm; treasury ticks up again (leg 2). Show the redeem tx link.
6. Show the *same* bet placed by **typing in chat** (`up eth 3500 2m 50`) — same fees, same contract, any supported asset.
7. Show the **leaderboard / streak**. Closing line: "every bet *and* every cashout, on either surface, pays the treasury — twice."

---

## 6. Guardrails
- Testnet + dUSDC only; never real funds or mainnet.
- **Both** fee percentages (`entry_fee_bps`, `exit_fee_bps`) live in the on-chain `FeeConfig` and are owner-adjustable independently.
- **Never bypass the router on either leg.** Bets go through `place_bet`; winning redeems go through `cashout`. The UI should not expose a raw `predict::redeem` path to the user.
- **Never hardcode an underlying.** The list of markets/assets comes from the live Predict indexer at runtime; if Predict adds ETH, SUI, or a new pair tomorrow, the bot and Mini App must show it without a code change.
- Log and surface every on-chain action (tx digests for both `place_bet` and `cashout`) — judges will test the real flow.
- Mobile-first throughout; the Mini App must feel like a real app, not a hackathon demo.
- Keep the code modular so the bot, Mini App, and contract can each be demoed alone if one breaks.
- When unsure about a DeepBook Predict detail, re-read the source in Section 2 instead of assuming.

---

**Start with Section 2 (verify the interface) and Phase 0 (prove the round trip). Report back with the tx digests before building anything else.**