# Hunchbook — Roadmap & Status

> Single source of truth for *where we are* and *what's next*. Update it as we ship: flip `[ ]` → `[x]` and move items between sections. Keep one line per item.

**Product:** Sui-native crypto-price prediction platform on DeepBook Predict — bet any-strike binaries on BTC/ETH, or LP into a hedged vault and earn the house edge. Sign in with Google.
**Today:** 2026-06-14 · **Hackathon deadline:** 2026-06-19 · **Current phase:** Phase 3 (Gaming / Automation layer)

### Legend
`[x]` shipped · `[~]` in progress · `[ ]` planned · `❄️` deferred (post-hackathon)

### Where we are (TL;DR)
Core trading loop, account/stats, and the **full hedged PLP vault** (deposit/withdraw, pfShare, PLP supply, hedge wings, keeper operator) are live on testnet. The active build is the **gaming/automation layer** (auto-roll, auto-bet, dopamine moments).

---

## 📝 TODO — next session (logged 2026-06-14)
- [ ] **Test auto-bet extensively** (Auto Studio `/strike`) — multiple rounds, stops, edge cases
- [x] **Settlement mechanics** — answered: European-style, settles at **expiry only**. "Above $66,800" wins only if BTC is above $66,800 *at the settlement time*; intermediate moves don't count (not touch/American).
- [x] **Is payout fixed at purchase?** — answered: **yes**. You lock in `units` (contracts) at the entry price; payout = `units × $1` fixed, odds locked at purchase. Win the fixed amount or lose stake (−1% fee).
- [x] **Fix layout when an active bet exists** — chart now fills its card (flex-1 + h-full), so the columns stay flush instead of padding out a gap
- [x] **Markets board** (replaced the repetitive market-cards row) — expiry chips + 3 one-tap cards (Up/Down with gauge, Above strikes, Range bands) priced live off SVI; chart gained a 5m/15m/1h history selector (new `/api/prices`) so the x-axis isn't a flat ~3-min window, and Range now colours the line green-inside / red-outside like Above/Below
- [ ] **Improve the Launch Token page** (`/launch`)
- [x] **Add a "How it works"** explainer — guided wizard: intent chooser (Predict/Earn) with DeepBook-style framed generative art, then 3 illustrated BTC steps per path with confetti payoff; opens from a nav help icon (hover tooltip) + mobile menu item
- [ ] **Improve leaderboard design**
- [ ] **Record the platform demo video** (3-min, for submission)

---

## ✅ Shipped

### Auth & infra
- [x] zkLogin (Google sign-in, no seed phrase) via Enoki
- [x] dUSDC balance + testnet faucet
- [x] Gas-sponsored transactions (free for users)
- [x] Keeper service (settlement / vault ops)

### Trading core
- [x] ABOVE / BELOW / RANGE bets, any strike ($1 steps), sub-hour expiries
- [x] SVI vol-surface pricing — win probability, payout odds, 1% router fee
- [x] Prediction chart (lightweight-charts): win/loss fill, draggable strike, range band, tracking tooltip
- [x] Expiry tabs + asset pill + ¢ contract-price readout
- [x] Quick-bet panel (stake presets, payout multiple, win probability, sliding CTA)
- [x] Draggable range ladder
- [x] Active positions + My Bets / history

### Social / retention (basics)
- [x] Leaderboard
- [x] Daily streak counter
- [x] Bet-success toast / share moment

### Vault (the house) — PLP + Hedge, deployed on testnet
- [x] Vault Move package published (`vault.move`, pfShare token, `hedge_policy`)
- [x] LP deposit / withdraw → pfShare mint/burn, NAV / share-price / APY
- [x] Supplies idle funds into the PLP pool (`supply_idle_to_plp` / `redeem_plp_to_idle`)
- [x] Hedge wings (OTM binary insurance) + utilization-based hedge policy
- [x] Keeper "robot operator" — marks PLP price, supplies, manages hedges

---

## 🚧 In progress — Phase 3: Gaming / Automation layer
*The "Stake dopamine, Aave honesty" layer. Biggest volume lever → more fees + vault yield.*

- [ ] **Day-1 spike:** does Enoki sign silently within a zkLogin session? (gates auto-bet UX)
- [x] Auto-Roll (one-tap) — "↻ Roll" re-enters same view at ATM on the next expiry, same stake
- [ ] Auto-Roll (automatic) — fire on settlement, up to N rolls (needs signing-behavior check)
- [ ] Roll-chain visual (connected stack + net P&L) in Active Bets
- [ ] Dopamine retrofit — P&L count-up + win light-sweep on existing wins
- [x] **Auto Studio** (`/strike`) — Stake-style auto-bet hub (home page untouched)
- [x] Auto-Bet engine (`use-auto-bet.ts`) — place → settle → adjust → roll, bounded + abortable
- [x] Strategy presets (STEADY / STREAK / PRESS) + flat / increase-on-loss
- [x] Running cockpit — progress dots, session P&L, round log, big STOP NOW
- [x] Risk disclosure — per-round odds, Max-at-risk, net-of-fee honesty; mandatory stop-loss to start
- [ ] Hold-to-arm gate (currently a plain Start button)
- [ ] Full ruin-probability number + martingale step-cap (3)
- [ ] Suppress per-round toasts during a run
- [ ] Roll-chain visual (connected stack + net P&L) in Active Bets
- [ ] Rate-limit `/api/sponsor` (auto-loops spend our sponsored gas)
- [ ] Vault Fuel meter — live "bettor losses → vault APY" (flywheel made visible)

---

## 📋 Next up — before deadline (if time)
- [ ] P&L leaderboard (realized P&L + win-rate boards)
- [ ] Live activity feed (real, anonymized bets/wins)
- [ ] Auto share cards (win / streak / roll-chain) with real odds + sparkline
- [ ] Daily Pick (one-tap featured setup)

---

## 💰 Monetization map
| Lever | How it earns | Status |
|---|---|---|
| Router fee (1% in/out) | every bet | [x] live — scales with volume |
| Auto-bet / auto-roll | multiplies bets per session | [ ] Phase 3 |
| Vault fees (20% perf + 1% mgmt) | AUM | [x] vault live (deposit/withdraw, PLP supply, hedge, keeper) |
| Tokenized vault share (pfShare) | composability → more deposits | ❄️ |
| Settled-redeem keeper tip | cut of payouts, runs unattended | ❄️ |
| Vol-arb bot (Predict vs Polymarket/HL) | trade the spread | ❄️ |
| Referral program | fee cut to grow users | ❄️ |
| Weekly tournaments (rake) | engagement + fee | ❄️ |
| Range-ladder vault (2nd flavor) | more AUM | ❄️ |

---

## ❄️ Future / V2 (post-hackathon, mainnet)
- [ ] Mainnet redeploy (day-one plan)
- [ ] pfShare tokenized vault share — composable in Sui DeFi
- [ ] Settled-redeem keeper with tipping
- [ ] Vol-arb bot: Predict ↔ Polymarket / Hyperliquid
- [ ] Referral / affiliate program
- [ ] Weekly tournaments + prize pools
- [ ] Range-ladder vault + BTC-collateral vault
- [ ] Kelly sizing, conditional/trigger bets, range auto-roll
- [ ] Season points / quests / tiered status
- [ ] Keeper-driven unattended automation (needs on-chain session-cap delegation)

---

## ⚠️ Open decisions / risks
- [ ] zkLogin auto-signing — silent vs "approve next N rounds" fallback (decides auto-bet/roll UX)
- [ ] Sponsored-gas drain from auto-loops — needs rate limit before shipping auto-bet
- [ ] Responsible-gaming guardrails locked as non-negotiable (brand = "Aave-credible, not predatory")

---

## 📊 Metrics to instrument (later)
Time-to-first-bet · bets/session · auto-bet adoption · D1/D7/D30 retention · total volume · router-fee revenue · vault inflow + APY · share cards / referral K-factor · % hitting stop-loss (responsible-gaming health)

---
*How to use: when you finish something, flip its box to `[x]` and (if it was in a future section) move it up to **Shipped**. Keep the TL;DR and Current phase line current.*
