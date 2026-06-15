# Backtest Notebook — Structure Plan

The notebook (`backtest.ipynb`) is structured in 7 sections, each a cluster of cells. We'll build cell-by-cell once data is fully pulled.

## Goal

Answer this single question:
> *Does a hedged PLP vault on DeepBook Predict deliver ≥14% APY with ≤7% max drawdown at realistic mainnet volumes?*

Output: charts + summary table + decision (proceed to Phase B, or rethink).

---

## Section 1 — Load and inspect data

**Cells**:
- Imports (`pandas`, `numpy`, `matplotlib`, `scipy.stats.norm`)
- Load each JSONL into a pandas DataFrame
- Quick sanity check: row counts, time spans, columns
- Convert `checkpoint_timestamp_ms` to `pd.Timestamp`, strikes from raw to dollars

**Sanity output**:
```
positions_minted: 1,128 rows, 2026-04-21 → 2026-06-04
unique oracles: ~70  (subset that had any bets)
unique traders: ~50
```

---

## Section 2 — Reconstruct vault state through time

The indexer gives us `vault_performance` — pre-computed share-price evolution. We use this as **ground truth** for naked PLP NAV.

**Cells**:
- Plot `share_price` over time → this is naked PLP NAV curve
- Compute: annualized return, max drawdown, Sharpe
- Overlay LP supply/withdrawal events as markers — see liquidity events

**Output**: One chart showing naked PLP NAV. **This is the "do nothing" baseline.**

---

## Section 3 — Aggregate bettor flow

For each settled oracle, compute:
- Total mint cost (premium collected by pool)
- Total redeem payout (what pool paid out)
- Net = collected − paid = PLP's profit on that expiry

**Cells**:
- Join `positions_minted` + `positions_redeemed` by `oracle_id`
- Aggregate per oracle: total_cost, total_payout, net_pnl
- Time series of cumulative pool PnL from bets
- **Compare**: does sum-of-bet-PnL match the vault_performance NAV delta? (Sanity check that we understand the protocol's accounting.)

**Output**: A "house edge per expiry" chart. Each dot = one settled oracle.

---

## Section 4 — Volume-scale simulation

This is the core innovation. Real testnet has ~2 bets per expiry; mainnet will have ~100s. We model what happens at scale.

**Model**:
- For each historical expiry, we keep the actual `is_up`, `strike` distribution, but **multiply quantity by scale factor**
- Pool's expected PnL scales linearly with quantity
- Net APY = annualized scaled PnL / vault NAV

**Cells**:
- Define `simulate_naked_plp(scale_factor)` function
- Run at scale = [1, 5, 10, 25, 50, 100]
- Plot: scale_factor → APY (log-x scale)

**Output**: One chart showing APY-vs-volume-scale. We expect a roughly linear relationship.

---

## Section 5 — Black-Scholes binary pricer (for hedge cost)

To price hedges, we need to know what an OTM binary costs **at the moment of hedging**.

**Cells**:
- Implement `bs_binary_price(spot, strike, ttm_years, vol, is_up)`:
  - `d2 = (ln(spot/strike) - 0.5*vol²*ttm) / (vol*sqrt(ttm))`
  - `price = norm.cdf(d2)` for UP
  - `price = norm.cdf(-d2)` for DOWN
- Verify against actual `ask_price` in the bet events (should match ±5%)

**Output**: One scatter plot — model price vs actual on-chain price. Aiming for tight diagonal.

---

## Section 6 — Hedged vault simulator

The vault holds 90% in PLP, uses 10% to buy OTM binary strips at each new expiry.

**Algorithm**:
```
1. At expiry T_start: pool NAV = N
2. Reserve hedge_budget = N * hedge_pct
3. Hedge composition:
     UP wing: buy K binaries at +2σ strike, cost C_up each
     DOWN wing: buy K binaries at -2σ strike, cost C_down each
     where K is sized to make total cost == hedge_budget
4. At expiry T_end:
     pool_pnl_from_bets = simulated PnL at volume scale
     hedge_payout = K * 1.0 * (1 if strike crossed else 0)
   Net NAV change = pool_pnl - hedge_budget + hedge_payout
```

**Cells**:
- Define `simulate_hedged_vault(scale, hedge_pct, sigma_threshold)` 
- Run grid: [scale=1, 10, 50, 100] × [hedge_pct=0%, 5%, 10%, 15%] × [sigma=1.5, 2.0, 2.5]
- For each combo: APY, max_drawdown, Sharpe

**Output**: 3D scatter (scale × hedge_pct → APY, color-coded by max_drawdown). We're looking for sweet spot.

---

## Section 7 — Decision summary

**Cells**:
- Print summary table:
  ```
  Scenario              Volume  Hedge   APY    MaxDD   Verdict
  Naked PLP (1×)         1×     0%      2.2%   0.0%    Testnet truth
  Naked PLP (50× scale)  50×    0%      X%     Y%      Stress
  Hedged 5% @ 2σ (50×)   50×    5%      X%     Y%      OK?
  Hedged 10% @ 2σ (50×)  50×    10%     X%     Y%      Better?
  Hedged 10% @ 2σ (100×) 100×   10%     X%     Y%      Best case
  ```
- Plot: NAV curves of naked vs hedged (under 50× scale, simulating mainnet conditions)
- Print decision: PROCEED / TUNE / RETHINK

---

## Acceptance criteria (notebook is "done" when)

- All cells run end-to-end without error
- Each section's chart renders correctly
- Section 7 prints a clear verdict
- Numbers are reproducible (random seeds set where applicable)
- Notebook exports cleanly to HTML for sharing (`jupyter nbconvert --to html`)

---

## Followups after notebook is green

If APY ≥ 14% and MaxDD ≤ 7% under realistic-volume scenario, we **proceed to Phase B** (Move vault contract).

If APY < 14% but MaxDD ≤ 7%, we **tune hedge parameters** in the notebook (try different sizing, different strikes).

If MaxDD > 7%, we **rethink hedge strategy** — maybe wider strips, multi-expiry layering, different greek targets.

If APY < 8% under all scenarios, we **pivot to a different product** (range ladder vault, or skip vault and pure bettor frontend).

---

## Time estimate

- Sections 1-3: ~30 min (mostly pandas wrangling)
- Section 4 (volume scaling): ~30 min
- Section 5 (BS pricer + validation): ~20 min
- Section 6 (hedged simulator): ~60 min (most complex)
- Section 7 (summary): ~10 min

Total: **~2.5 hours of focused work** once data is pulled.
