# Hunchbook Platform — Requirements Document

**Version**: 0.2 (web-first pivot)
**Date**: 2026-06-02
**Hackathon deadline**: 2026-06-19
**Primary surface**: Mobile-responsive web app
**Auth model**: zkLogin (Google / Apple / email OAuth → Sui address)

---

## 1. Vision

Hunchbook is a **Sui-native web platform** where bettors place customisable prediction-market trades on DeepBook Predict while LPs deposit dUSDC into hedged vaults that earn from bettor losses with structurally bounded drawdown. A gaming layer (daily picks, streaks, leaderboards) drives retention. Composable share tokens plug into the wider Sui DeFi stack.

**Architecture choice**: web-only (mobile-responsive). No app store gatekeeping, no Telegram dependency. zkLogin handles auth — users sign in with Google/Apple/email; no seed phrases, no custodial liability.

**One-line pitch**: *"Polymarket + Yearn + Stake.com fused on Sui — sign in with Google, place any-strike bets, earn from house edge."*

---

## 2. User Personas

| Persona | Goal | Avg ticket | Acquisition channel |
|---|---|---|---|
| **Casual Bettor** | 1-tap "BTC up or down" bets, gaming feel | $1–$50 | Social, viral share cards |
| **Pro Bettor** | Custom strikes, ranges, live charts, analytics | $100–$5k | DeFi Twitter, Sui ecosystem |
| **Passive LP** | Deposit & earn 12–15% APY | $100–$10k | Yield aggregators, search |
| **Institutional LP** | Risk transparency, drawdown caps, audit trail | $10k–$1M | Direct outreach, DeepBook intros |
| **Fund Manager** (V2) | Launch own bet-fund token | $1k+ stake | Power users self-select |
| **Keeper Operator** | Run hedger/redeemer for tips | n/a | Developer docs |

---

## 3. Functional Requirements

### 3.1 Auth & Wallet (zkLogin)

| ID | Requirement | Priority |
|---|---|---|
| F1.1 | "Sign in with Google" via Sui zkLogin → Sui address derived from JWT | MVP |
| F1.2 | "Sign in with Apple" via zkLogin | MVP |
| F1.3 | Email-based zkLogin (Sui Salt service backed) | MVP |
| F1.4 | Address persistence across sessions (zkLogin recoverable via re-auth) | MVP |
| F1.5 | "Connect external wallet" option for advanced users (Suiet, Sui Wallet, Slush) | V2 |
| F1.6 | Wallet address shown in header, copyable | MVP |
| F1.7 | Sign-out clears session, requires re-auth | MVP |
| F1.8 | Account recovery flow (re-OAuth → same address) documented | MVP |
| F1.9 | Multi-account: one user can switch between OAuth identities | V3 |

### 3.2 Betting

| ID | Requirement | Priority |
|---|---|---|
| F2.1 | Markets page: live cards for active oracles (BTC, ETH, etc.) | MVP |
| F2.2 | Each card shows: spot price, expiry countdown, 4 probability tiers, range/custom buttons | MVP |
| F2.3 | Probability tier buttons display computed prob % + payout multiplier (live devInspect) | MVP |
| F2.4 | Side picker (UP/DOWN) after tier selection, with live cents pricing | MVP |
| F2.5 | Custom strike picker: any value in $1 increments from $50k+ | MVP |
| F2.6 | Strike Studio: interactive ±$1k/±$100 stepper with live re-pricing | MVP |
| F2.7 | Range bet picker (lower + upper strike, `predict::mint_range`) | MVP |
| F2.8 | Auto-pilot recurring bets (vibe + side + interval + budget) | V2 |
| F2.9 | Switch between BTC/ETH/other assets via tabs or dropdown | MVP |
| F2.10 | Positions page: all open positions with live PnL, settlement status | MVP |
| F2.11 | Cashout button on settled winning positions | MVP |
| F2.12 | Bet history page with filters (asset, side, time range, vibe) | MVP |
| F2.13 | Bet preview modal before confirm (cost, max payout, breakeven, win probability) | MVP |
| F2.14 | Slippage warning if price moves > 2% during preview-to-confirm | V2 |
| F2.15 | 1% router entry/exit fee accrued to platform treasury | MVP |
| F2.16 | TradingView lightweight chart for each asset on market detail page | MVP |
| F2.17 | Order tickets persistable as draft (saved in localStorage) | V2 |

### 3.3 Vault — PLP+Hedge

| ID | Requirement | Priority |
|---|---|---|
| F3.1 | Move vault contract: deposit dUSDC → mint pfShare token, proportional to NAV | MVP |
| F3.2 | Move vault contract: withdraw pfShare → burn + return proportional dUSDC | MVP |
| F3.3 | NAV calculation includes: PLP balance + hedge positions + accrued fees | MVP |
| F3.4 | On deposit, allocate ~90% to `predict::supply` (PLP) and reserve ~10% for hedges | MVP |
| F3.5 | Hedge sizing: simple fixed-% OTM strips at +2σ/−2σ from spot (MVP) | MVP |
| F3.6 | Hedge sizing v2: dynamic based on PLP utilization, IV/RV gap, book skew | V2 |
| F3.7 | Auto-roll keeper: rebalance hedges at each new expiry cycle | MVP |
| F3.8 | Performance attribution: separate PLP yield vs hedge cost in NAV history | MVP |
| F3.9 | Vault page: live NAV, 7d/30d APY, drawdown chart, hedge composition, user's share value | MVP |
| F3.10 | Deposit flow: amount input + slider, "you'll receive X pfShare" preview, confirm | MVP |
| F3.11 | Withdraw flow: pfShare amount or % slider, "you'll receive Y dUSDC" preview | MVP |
| F3.12 | Capacity caps (max AUM cap, configurable by admin) | MVP |
| F3.13 | Pause function (admin can freeze deposits/withdrawals in emergency) | MVP |
| F3.14 | Time-locked admin keys (48h delay on critical ops) | V2 |
| F3.15 | Multiple vault flavors (Range Ladder, BTC-collateral, etc.) selectable on vault list page | V2 |
| F3.16 | Performance fee: 20% of net positive returns, accrued at settlement events | MVP |
| F3.17 | Management fee: 1% of AUM per year, accrued continuously | MVP |
| F3.18 | Withdraw cooldown (24h) to prevent NAV-arbitrage attacks | V2 |
| F3.19 | Deposit / withdraw transaction history per user | MVP |

### 3.4 Gaming Layer

| ID | Requirement | Priority |
|---|---|---|
| F4.1 | Daily Pick widget on dashboard: "BTC ↑ or ↓ by tomorrow same time?" 1-tap | MVP |
| F4.2 | Streak counter on user profile, persisted server-side, incremented on win | MVP |
| F4.3 | Streak badges (text icons) at 3 / 7 / 14 / 30-day milestones | MVP |
| F4.4 | Browser push notifications for: bet settled, streak milestone, vault hedge rolled | MVP |
| F4.5 | Leaderboard page: weekly + all-time, ranked by win-rate × volume | MVP |
| F4.6 | Public profile pages (opt-in): show username, streak, win rate, badges | V2 |
| F4.7 | NFT badge minting for 30+ day streaks | V3 |
| F4.8 | Friend duels: invite link → both sides of same market, winner takes pot | V2 |
| F4.9 | Auto-generated share cards (PNG, via canvas API) for big wins, Twitter/X share | V2 |
| F4.10 | Coinflip 60-second markets with animated reveal | V3 |
| F4.11 | Weekly tournament with prize pool funded from platform fees | V3 |

### 3.5 Analytics

| ID | Requirement | Priority |
|---|---|---|
| F5.1 | Pro mode toggle in user settings — unlocks advanced UI elements | MVP |
| F5.2 | Per-position PnL tracking, realized + unrealized, exportable as CSV | MVP |
| F5.3 | User performance dashboard: win rate by vibe / asset / time-of-day | V2 |
| F5.4 | Live 3D vol surface viewer (Three.js or react-three-fiber) | V2 |
| F5.5 | Historical NAV chart for vault (TradingView lightweight charts) | MVP |
| F5.6 | Drawdown chart for vault with stress event annotations | V2 |
| F5.7 | Public API for vault NAV/APY (REST + WebSocket for live updates) | V2 |
| F5.8 | Backtest playground: user inputs strategy parameters, sees historical PnL | V3 |

### 3.6 Keepers

| ID | Requirement | Priority |
|---|---|---|
| F6.1 | Auto-roll keeper (Node.js daemon): detects vault hedge expiry, rolls into next cycle | MVP |
| F6.2 | Settled-redeem keeper: claims payouts on users' positions for a tip | MVP |
| F6.3 | Keeper anti-collision: distributed locking via Postgres advisory locks | V2 |
| F6.4 | Keeper health endpoint (HTTP `/health` for monitoring) | MVP |
| F6.5 | Oracle health monitor: alerts if SVI feeder stale > threshold | V2 |
| F6.6 | Keeper service publishes metrics (Prometheus) for ops dashboard | V2 |

### 3.7 Bet-Funds (V2 — Post-hackathon)

| ID | Requirement | Priority |
|---|---|---|
| F7.1 | Fund manager creates `$XXX-FUND` token with required self-stake | V2 |
| F7.2 | Investor buys/sells fund tokens via bonding curve | V2 |
| F7.3 | Fund manager places bets only from contract-controlled wallet | V2 |
| F7.4 | Performance fee shared: manager 60%, platform 15%, vault treasury 25% | V2 |
| F7.5 | Investor can exit anytime via redeem (force-close manager positions) | V2 |
| F7.6 | Fund leaderboard ranked by NAV growth | V2 |
| F7.7 | Geo-blocking for restricted jurisdictions (regulatory) | V2 |

### 3.8 Composability (V2 — Post-hackathon)

| ID | Requirement | Priority |
|---|---|---|
| F8.1 | pfShare token implements Sui Coin standard with 9 decimals | MVP |
| F8.2 | pfShare accepted as collateral in `deepbook_margin` | V2 |
| F8.3 | pfShare composable with `iron_bank` USDsui supply | V2 |
| F8.4 | Public Move SDK for third-party integrations | V2 |
| F8.5 | TypeScript SDK for off-chain integrations (npm package) | V2 |

---

## 4. Non-Functional Requirements

### 4.1 Performance (Web app specific)

| ID | Requirement | Target |
|---|---|---|
| NF1.1 | Largest Contentful Paint (LCP) | < 2.5s p75 |
| NF1.2 | First Input Delay (FID) | < 100ms p75 |
| NF1.3 | Cumulative Layout Shift (CLS) | < 0.1 |
| NF1.4 | Time to Interactive (TTI) on mobile 3G | < 5s |
| NF1.5 | API response time for non-blockchain reads | < 200ms p95 |
| NF1.6 | API response time for devInspect reads | < 2s p95 |
| NF1.7 | Bet placement tx submission feedback | < 1s |
| NF1.8 | Tx confirmation feedback (after Sui finality) | < 8s p95 |
| NF1.9 | Concurrent users supported at launch | 1,000 |
| NF1.10 | Concurrent users supported at scale (Year 1) | 50,000 |
| NF1.11 | Daily transaction volume | 10,000 tx/day at scale |
| NF1.12 | Initial JS bundle size (gzip) | < 200kb |

### 4.2 Security

| ID | Requirement | Notes |
|---|---|---|
| NF2.1 | zkLogin uses verified OAuth providers only (Google, Apple, Facebook) | MVP |
| NF2.2 | OAuth client secrets in env vars, never in client code | MVP |
| NF2.3 | All API routes validated with Zod or equivalent schema validation | MVP |
| NF2.4 | OWASP Top 10 mitigations: CSP, XSS protection, CSRF tokens, rate limiting | MVP |
| NF2.5 | Smart contract audit before mainnet launch | V2 ($30-60k from grant) |
| NF2.6 | Vault pause function controlled by 2-of-3 multisig | V2 |
| NF2.7 | Time-locked admin keys (48h delay on critical ops) | V2 |
| NF2.8 | Bug bounty program ($1k-$10k per critical) | Post-mainnet |
| NF2.9 | Rate limiting on API endpoints (anti-spam, anti-DDoS) | MVP |
| NF2.10 | Withdrawal limits on vault per address per day | MVP |
| NF2.11 | All client-side state revalidated server-side before mutation | MVP |
| NF2.12 | TLS 1.3 only, HSTS enforced | MVP |
| NF2.13 | No PII stored beyond OAuth subject claim and Sui address | MVP |
| NF2.14 | Cookies: SameSite=Strict, Secure, HttpOnly | MVP |

### 4.3 Reliability

| ID | Requirement | Target |
|---|---|---|
| NF3.1 | Web app uptime | 99.5% (allowing 3.5h/month down) |
| NF3.2 | Vault contract uptime (cannot fail) | 100% |
| NF3.3 | Graceful degradation if indexer down (cached data + warning banner) | MVP |
| NF3.4 | Tx retry logic for failed submissions (exponential backoff, 3x) | MVP |
| NF3.5 | Database backups (Postgres daily snapshots, point-in-time recovery) | MVP |
| NF3.6 | Disaster recovery: full restore from backups within 1h | V2 |
| NF3.7 | Keeper redundancy (run 2+ instances with leader election) | V2 |
| NF3.8 | CDN-cached static assets, fallback to origin | MVP |
| NF3.9 | Error monitoring (Sentry) with alerts on > 1% error rate | MVP |

### 4.4 Scalability

| ID | Requirement | Target |
|---|---|---|
| NF4.1 | Stateless API routes (state in DB only, horizontal scale) | MVP |
| NF4.2 | Database: Postgres with read replicas for read-heavy queries | V2 |
| NF4.3 | Vault contract supports capacity caps to prevent over-deposit | MVP |
| NF4.4 | Off-chain ledger reconciles with on-chain state hourly | MVP |
| NF4.5 | Caching layer (Redis or in-memory) for hot reads (markets, oracle states) | V2 |
| NF4.6 | Background job queue for non-critical tasks (analytics, notifications) | V2 |

### 4.5 Usability

| ID | Requirement | Notes |
|---|---|---|
| NF5.1 | Onboarding from landing page to first bet placeable | < 90s |
| NF5.2 | Mobile-responsive design (tested on iOS Safari, Chrome Android) | MVP |
| NF5.3 | Accessibility: WCAG 2.1 AA compliance | MVP |
| NF5.4 | Dark mode by default, light mode toggle | MVP |
| NF5.5 | All errors actionable (tell user what to do, not just what failed) | MVP |
| NF5.6 | Loading skeletons for all data-fetching states | MVP |
| NF5.7 | Optimistic UI updates where possible (bet submit, deposit) | MVP |
| NF5.8 | Empty states with calls-to-action ("No positions — tap Markets to place one") | MVP |
| NF5.9 | Multi-language support: English + Hindi | V2 |
| NF5.10 | Keyboard navigation support across all flows | MVP |

### 4.6 Compliance & Legal

| ID | Requirement | Notes |
|---|---|---|
| NF6.1 | Terms of Service published, accepted on first use (modal) | MVP |
| NF6.2 | Risk disclosures: "you can lose money", "testnet = play money" | MVP |
| NF6.3 | Geo-blocking for US, UK, sanctioned jurisdictions (mainnet) | V2 |
| NF6.4 | KYC for vault deposits > $10k (mainnet) | V2 (regulatory) |
| NF6.5 | Bet-fund feature: legal review before launch (potential security) | V2 blocker |
| NF6.6 | Tax reporting export (CSV of bets + winnings + vault interactions) | V2 |
| NF6.7 | Privacy: no PII stored beyond OAuth subject and Sui address | MVP |
| NF6.8 | Cookie consent banner (GDPR if shipping in EU) | V2 if EU geo |

### 4.7 Maintainability

| ID | Requirement | Target |
|---|---|---|
| NF7.1 | TypeScript strict mode, no `any` without justification | MVP |
| NF7.2 | Move code follows Sui Move idioms, passes `sui move build` clean | MVP |
| NF7.3 | Test coverage for critical paths (auth, bet, deposit, withdraw) | > 70% |
| NF7.4 | Smart contract test suite covers all entry functions | 100% |
| NF7.5 | Code review before merge (post-team formation) | V2 |
| NF7.6 | Documentation: README + architecture diagram + API spec (OpenAPI) | MVP |
| NF7.7 | Observability: structured logging, error monitoring | MVP |
| NF7.8 | Component library based on shadcn/ui for consistency | MVP |

### 4.8 Cost

| ID | Requirement | Target |
|---|---|---|
| NF8.1 | Web hosting (Vercel free tier or equivalent) | $0–$20/mo |
| NF8.2 | Database hosting (Supabase free tier or Postgres on Fly.io) | $0–$25/mo |
| NF8.3 | Domain + DNS | $15/yr |
| NF8.4 | Keeper service hosting (small VPS or Fly.io worker) | $5–$15/mo |
| NF8.5 | Sentry error monitoring (free tier) | $0/mo |
| NF8.6 | Gas costs absorbed via 1% router fee (no user-facing gas charge) | MVP |
| NF8.7 | Audit cost budgeted from grant funding | $30-60k V2 |
| NF8.8 | **Total launch infra cost** | **< $75/month** |

---

## 5. Out of Scope for Hackathon MVP

Explicitly NOT shipping in the June 19 submission:

- ❌ Telegram bot (shelved per 2026-06-02 pivot)
- ❌ Native mobile apps (web only; PWA optionally V2)
- ❌ Full math-optimized hedge sizing (dynamic IV/RV gap, Kelly fractional)
- ❌ Skew-aware delta hedging via DeepBook spot
- ❌ Multiple vault flavors (only PLP+Hedge ships; Range Ladder etc. roadmap-only)
- ❌ User-launched bet-fund tokens (regulatory risk + 4-6 wk build)
- ❌ Composability integrations with deepbook_margin / iron_bank (pitch slide only)
- ❌ NFT badge minting (text-only streak display for MVP)
- ❌ Friend duels, tournaments, coinflip 60s markets, public profiles
- ❌ B2B analytics API
- ❌ Multi-language (English-only for hackathon)
- ❌ KYC / geo-blocking (testnet-only, no real money)
- ❌ External wallet connect (zkLogin only for MVP simplicity)

---

## 6. MVP Acceptance Criteria

The hackathon submission is "complete" when **all** of these pass:

| # | Criterion | How to verify |
|---|---|---|
| AC1 | User can sign in with Google via zkLogin and see their Sui address | E2E test |
| AC2 | Markets page shows live BTC card with 4 probability tiers | Screenshot |
| AC3 | User can place a quick-bet via tier selection + UP/DOWN side picker | E2E test |
| AC4 | User can place a range bet via picker | E2E test |
| AC5 | User can place a custom-strike bet via Strike Studio steppers | E2E test |
| AC6 | User can view open positions with live PnL and settlement status | E2E test |
| AC7 | User can cashout settled winning positions | E2E test |
| AC8 | User can deposit dUSDC into vault via Vault page and receive pfShare | E2E test |
| AC9 | User can withdraw pfShare and receive proportional dUSDC | E2E test |
| AC10 | Vault dashboard shows NAV, APY, user's share value, drawdown chart | Screenshot |
| AC11 | Auto-roll keeper rebalances hedges across at least 2 expiry cycles | Live demo |
| AC12 | Daily Pick widget allows 1-tap UP/DOWN and updates streak counter | Manual test |
| AC13 | Leaderboard shows weekly rankings | Screenshot |
| AC14 | Backtest notebook shows ≥14% APY, ≤7% max DD over 7-day historical data | Notebook output |
| AC15 | Demo video (≤ 3 min) shows full bettor + LP loop | Video file |
| AC16 | README explains architecture + value proposition | Doc review |
| AC17 | TypeScript strict typecheck passes across all workspaces | `pnpm -r typecheck` |
| AC18 | Move contract builds clean and unit tests pass | `sui move test` |
| AC19 | Lighthouse score on landing page > 85 perf, > 90 a11y | Lighthouse run |
| AC20 | Site loads & is interactive on iPhone 13 mobile Safari | Manual test |

---

## 7. System Architecture

```
                  ┌─────────────────────────────────────┐
                  │           Web App (Next.js)         │
                  │   Mobile-responsive React + TS      │
                  │   Tailwind + shadcn/ui              │
                  │   TanStack Query for data           │
                  └────────────────┬────────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
        ┌─────────▼──────┐  ┌──────▼─────┐  ┌───────▼────────┐
        │ Sui zkLogin    │  │ API Routes │  │ Sui RPC        │
        │ (Google/Apple/ │  │ (Next.js)  │  │ (Mysten        │
        │  email OAuth)  │  │            │  │  fullnode +    │
        └────────────────┘  └──────┬─────┘  │  indexer)      │
                                   │        └────────┬───────┘
                                   ▼                 │
                            ┌──────────────┐         │
                            │ Postgres DB  │         │
                            │ - User profs │         │
                            │ - Streaks    │         │
                            │ - Daily picks│         │
                            │ - Off-chain  │         │
                            │   analytics  │         │
                            └──────────────┘         │
                                                     │
                  ┌──────────────────────────────────┴────┐
                  │              Sui chain                │
                  │ - DeepBook Predict (mint/redeem)      │
                  │ - Hunchbook Router (1% fee)         │
                  │ - PLP+Hedge Vault (new)               │
                  │ - pfShare token (new)                 │
                  └───────────────────────────────────────┘
                                   ▲
                                   │
                  ┌────────────────┴─────────────┐
                  │     Keeper Services (Node)   │
                  │ - Auto-roll vault hedges     │
                  │ - Settled-redeem positions   │
                  │ - Health monitoring          │
                  └──────────────────────────────┘
```

---

## 8. Tech Stack Mapping

| Layer | Tech | Notes |
|---|---|---|
| **Frontend framework** | Next.js 14+ (App Router) | TypeScript strict |
| **UI library** | React 18 | Server + client components |
| **Styling** | Tailwind CSS + shadcn/ui | Dark mode default |
| **State** | Zustand (UI state) + TanStack Query (server state) | |
| **Auth** | @mysten/zk-login (zkLogin SDK) | Google/Apple/email |
| **Charts** | TradingView Lightweight Charts | MIT license, free |
| **Forms** | react-hook-form + Zod validation | |
| **Sui SDK** | @mysten/sui | TypeScript |
| **dApp Kit** | @mysten/dapp-kit | For wallet connect V2 |
| **Smart contracts** | Move (Sui flavor) | Router (done) + Vault (TBD) |
| **Database** | Postgres (Supabase or Fly.io managed) | Off-chain user data |
| **ORM** | Drizzle ORM | Lightweight, TypeScript-native |
| **Hosting** | Vercel (frontend) + Fly.io (keepers) | Free tier viable |
| **Backend API** | Next.js API routes | No separate backend service |
| **Keepers** | Node.js daemons | PM2 or Fly.io workers |
| **Backtest** | Python + Jupyter | Pandas, matplotlib |
| **Monorepo** | pnpm workspaces | shared, web, contracts, keepers |
| **Error monitoring** | Sentry | Free tier |
| **Analytics** | Plausible or Umami | Privacy-friendly |

---

## 9. What Carries Over from Existing Bot Work

Salvageable code (~30-40% of bot codebase):

| Existing file | Reusable? | Notes |
|---|---|---|
| `shared/src/config.ts` | ✅ Direct reuse | All testnet IDs, constants |
| `shared/src/predict.ts` | ✅ Direct reuse | All PTB builders for mint/redeem/range |
| `shared/src/indexer.ts` | ✅ Direct reuse | Indexer client |
| `move/hunchbook_router/` | ✅ Direct reuse | Router contract already deployed |
| `bot/src/db.ts` | ⚠️ Adapt | Schema concept transfers, but Postgres now |
| `bot/src/crypto.ts` | ❌ Drop | No more custodial keys; zkLogin handles auth |
| `bot/src/index.ts` (1500 LOC) | ⚠️ ~20% reusable | Move-call logic stays; grammY UI throwaway |
| `scripts/phase0`, `phase1` | ✅ Direct reuse | Useful for testnet validation |

Net: **~500 lines of pure business logic transfer**, ~1000 lines of bot UI thrown away. Worth it for the platform pivot.

---

## 10. Risks & Mitigations (Top 5)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vault smart contract bug drains TVL | Low | Existential | Audit + capacity caps + pause function + time-lock |
| Sui Predict mainnet delayed | Medium | High | Test thoroughly on testnet, partner with DeepBook team |
| zkLogin OAuth provider revokes app credentials | Low | Medium | Multi-provider support, fallback to email |
| Bet-fund feature triggers regulatory action | Medium (V2) | High | Geo-block, legal review before V2 launch |
| Hackathon submission incomplete by June 19 | Medium | High | Aggressive scope cuts (Section 5), demo > polish |

---

## 11. 17-Day MVP Build Plan

| Days | Workstream | Deliverable |
|---|---|---|
| **1-2** | Project setup | Next.js scaffold, Tailwind, shadcn/ui, Postgres schema, zkLogin integration |
| **3-4** | Backtest notebook | Pull historical Predict data, simulate vault PnL, validate numbers |
| **5-7** | Vault Move contract | Deposit/withdraw, pfShare token, hedge logic (fixed-% v1) |
| **8-10** | Betting UI (web) | Markets page, position picker (vibes + custom + range), Strike Studio |
| **11-12** | Vault UI (web) | Vault page with NAV, APY, deposit/withdraw flows |
| **13** | Gaming layer | Daily Pick widget + streak counter + browser push notifications |
| **14** | Keepers | Auto-roll keeper service for vault hedges |
| **15** | Leaderboard + polish | Leaderboard page, error states, loading skeletons |
| **16** | Demo prep | 3-min video, README, screenshots |
| **17** | Buffer + submission | Bug fixes, final QA, submit |

---

## 12. Glossary

- **zkLogin** — Sui's native auth using ZK-proofs over OAuth JWT claims; user signs in with Google/Apple, gets a deterministic Sui address without managing a seed phrase
- **Bettor** — user placing bets via the web app
- **LP** — liquidity provider depositing into vault
- **pfShare** — ERC20-equivalent Sui Coin representing a share of the vault
- **NAV** — Net Asset Value of the vault, denominated in dUSDC
- **PLP** — Predict LP token from `predict::supply`
- **Hedge** — OTM binary bought by vault to cap downside
- **Vibe** — pre-configured strike offset (Likely / Even / Stretch / Long shot)
- **SVI** — stochastic volatility-inspired surface parameterization
- **MVP** — minimum viable product (hackathon submission)
- **V2** — post-hackathon roadmap (1-3 months out)
- **V3** — long-term (6+ months)
- **LCP / FID / CLS** — Web Vitals (Core Web Performance metrics from Google)
