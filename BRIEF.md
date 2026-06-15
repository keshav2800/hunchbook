# Hunchbook — Product Brief

A concise project brief usable as input to any AI tool (logo generator, branding agency, marketing copy, pitch deck builder, etc).

---

## Name

**Hunchbook** (pronounced OR-in, 4 letters)

Alternate names under consideration: Saren, Selys. Final choice TBD.

---

## One-Line Pitch

> *Sui-native crypto-prices prediction platform: trade any-strike binaries on BTC/ETH with options-grade math, or deposit dUSDC into our hedged vault to earn from house edge — all from a single web app, no wallets, sign in with Google.*

---

## The Product

Hunchbook is a **web platform on the Sui blockchain** built on top of **DeepBook Predict**, a sub-hour binary options protocol with a live volatility surface. Three product layers stack into one app:

### Layer 1: Betting (the casino floor)

Users place binary bets on crypto prices:
- *"Will BTC end above $70,500 at 4:00 PM UTC?"* (1-tap quick bets)
- *"Will BTC land between $70k and $72k?"* (range bets)
- *"I want a custom strike of $71,287"* (any strike in $1 increments)
- 4 pre-set probability tiers: Likely (~70%), Even (~50%), Stretch (~30%), Long shot (~15%)
- Daily Pick widget: one-tap streak-building bet
- Streak counter, leaderboard, badge milestones

### Layer 2: Hedged Vault (the bank)

Liquidity providers deposit dUSDC and earn yield:
- Vault supplies capital to DeepBook Predict's PLP (Predict LP) pool — essentially becomes the house
- Buys out-of-the-money binary insurance to cap tail risk
- Net APY target: **12–16%** with max drawdown capped at **~5%**
- Performance fee: 20%, management fee: 1%
- pfShare tokenized share, composable in other Sui DeFi

### Layer 3: Gaming / Social (the retention engine)

- Daily streak counter (consecutive wins)
- Weekly leaderboard
- Auto-generated share cards for big wins
- Live activity feed ("Anonymous bet $420 on BTC↑ — 30s ago")
- Friend duels (V2)

---

## Target Users

| Persona | Goal | Ticket size |
|---|---|---|
| Casual Bettor | 1-tap "BTC up or down" with gaming feel | $1–$50 |
| Pro Bettor | Custom strikes, charts, options-grade math | $100–$5k |
| Passive LP | 12–15% APY with capped drawdown | $100–$10k |
| Institutional LP | Risk transparency, audited vault | $10k–$1M |
| Power User (V2) | Launch their own bet-fund token | $1k+ stake |

---

## What Makes It Different

| Competitor | Their weakness | Hunchbook's edge |
|---|---|---|
| **Polymarket** | Thin order books on BTC binaries; weekly expiries only; bad fills | Sub-hour rolling expiries, vol-surface pricing, deep vault liquidity |
| **Stake.com** | Pure casino, no real markets, house always wins | Real on-chain markets, bettors can be LPs themselves |
| **Yearn / Aave vaults** | Yield without exciting UX | Vault yield + gaming hook drives retention |
| **Other prediction protocols** | Fixed-contract markets ($70k, $75k strikes only) | Any strike in $1 increments — first protocol with continuous strike grid |

**Core insight**: Bettors + LPs in one app creates a self-reinforcing flywheel — bettors' losses become LP yield; high LP yield attracts more capital; deeper liquidity attracts more bettors.

---

## Tech Stack

- **Blockchain**: Sui (testnet now, mainnet day 1 launch planned)
- **Protocol**: DeepBook Predict (third-party, live on testnet)
- **Frontend**: Next.js 14 + TypeScript + Tailwind + shadcn/ui
- **Auth**: Sui zkLogin (Google / Apple / email — no seed phrases)
- **Database**: Postgres (off-chain user state, streaks, gaming)
- **Charts**: TradingView Lightweight Charts
- **Smart contracts**: Move (Sui flavor) — custom router (deployed) + vault (in progress)
- **Hosting**: Vercel + Fly.io for keepers

---

## Brand Personality

| Dimension | Direction |
|---|---|
| **Tone** | Confident, sharp, math-aware. Not casino-tacky. Not corporate-bland. |
| **Audience feeling** | "Smart people made this. I trust it with my money. It also makes betting fun." |
| **Reference brands** | Polymarket (trader clarity) + Stake.com (dopamine triggers) + Aave (institutional credibility) |
| **NOT** | Pump.fun chaos, Tinder-app gamification, Robinhood naïveté |

---

## Visual Direction

| Element | Recommendation |
|---|---|
| **Theme** | Dark mode primary. Light mode optional. |
| **Primary palette** | Midnight navy (#0A0E1A), electric cyan (#00D4FF), signal red (#FF3B6E) |
| **Accent palette** | Warm gold (#F5C842) for win states, muted purple for streaks |
| **Typography** | Bold sans-serif (Inter, Geist, or Söhne). Italic accents for the brand name. Tabular nums for prices. |
| **Imagery** | Geometric shapes, price-line motifs, subtle grid patterns. No stock-photo people. No casino chips. |
| **Logo concept** | Stylized **O** with a horizontal line inside (like a price level on a chart), OR a curved Sui-style wave forming a wordmark "hunchbook". |

---

## Tagline Options

Pick one for the homepage hero:

1. *"Hunchbook. See the line."*
2. *"Hunchbook. Markets, foreseen."*
3. *"Hunchbook. Sharper outcomes, sooner."*
4. *"Hunchbook. Trade what's next."*
5. *"Hunchbook. Where the outcome begins."*

---

## Sample Marketing Copy

**Hero headline**:
> *Pick any price. At any time. Trade it as a bet.*

**Sub-headline**:
> *Hunchbook turns DeepBook Predict's volatility surface into a one-tap prediction market. Sign in with Google, place a bet on BTC's next move, or deposit dUSDC into our hedged vault and earn from every bettor in the room.*

**Feature blocks**:

- **Any Strike** — "Most apps lock you to $70k or $75k. Hunchbook lets you bet on $71,287 if that's the line you see."
- **Hedged Vault** — "12–16% APY, max 5% drawdown. The math is in our backtest, not just our pitch."
- **Sign In With Google** — "No seed phrases. No browser extensions. Sui zkLogin makes wallets disappear."
- **Daily Streaks** — "One bet a day. Stack 30 wins. Earn a permanent NFT badge."

---

## Hackathon Context

- **Hackathon**: DeepBook Predict hackathon, deadline **June 19, 2026**
- **Submission**: MVP on Sui testnet — bettor flow + vault deposit/withdraw + gaming layer + 7-day backtest notebook + 3-min demo video
- **Prize ambition**: Win the consumer/frontend track ($5k–$25k estimated)
- **Post-hackathon**: mainnet day 1 launch, Sui Foundation grant, scale AUM to $1M+ within 6 months

---

## Business Model

- **Vault fees**: 20% performance + 1% management on AUM
- **Bet router fee**: 1% entry, 1% exit (already deployed on testnet)
- **Year 1 revenue target**: $70k–$155k (hackathon prize + grant + early AUM)
- **Year 2 revenue target**: $200k–$800k (scaled AUM + organic growth)
- **Long-term**: ecosystem play with multiple vault flavors, user-launched bet-funds, composability across Sui DeFi

---

## What to Generate (use this brief for)

Drop this brief into AI tools to generate:

- **Logo concepts** — Midjourney, DALL-E, Ideogram (use Visual Direction + Brand Personality sections)
- **Landing page copy** — ChatGPT/Claude (use One-Line Pitch + Feature blocks + Tagline)
- **Pitch deck slides** — Gamma, Tome (use entire brief)
- **Brand guidelines doc** — Claude/ChatGPT (use Visual Direction)
- **Demo video script** — Claude/ChatGPT (use Layer descriptions + sample marketing copy)
- **Twitter/X announcement threads** — Claude/ChatGPT (use Differentiation + Tagline)
- **Investor pitch one-pager** — Claude/ChatGPT (use Business Model + Targets)

---

## Quick Prompt for Logo Generation

Paste this into Midjourney/Ideogram/DALL-E:

> *Minimalist logo for a fintech prediction-trading platform called "Hunchbook". Premium, formal, slightly mystical. Stylized lowercase "hunchbook" wordmark, OR an abstract O with a horizontal line inside (representing a price level on a chart). Dark navy background, electric cyan accent. Sans-serif typography, bold. No casino imagery, no stock-photo people. Think Polymarket meets Aave aesthetic. Geometric, sharp, confident. SVG-style flat design.*

---

## Quick Prompt for Landing Page Copy

Paste this into Claude/ChatGPT:

> *I'm building Hunchbook, a Sui-native crypto-prices prediction platform. Users sign in with Google (Sui zkLogin), place binary bets on BTC/ETH price movements with custom strikes, and can also deposit dUSDC into a hedged vault earning 12-16% APY. Brand personality: confident, sharp, math-aware. Reference brands: Polymarket + Stake.com + Aave. Tagline candidate: "Hunchbook. See the line." Write a complete landing page in Markdown: hero section with headline + sub-headline + 3 feature blocks + CTA, followed by a "How it works" 3-step section, followed by FAQ with 5 questions, followed by a footer. Tone: professional but approachable, sentences punchy, no buzzwords like 'revolutionize'.*
