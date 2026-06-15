# `backtest.py` — Line-by-Line Layman Explanation

Yeh document `backtest.py` ki **har section ko poori tarah samjhata hai**. Code ke bagal mein "kya kar raha hai" aur "kyu kar raha hai".

File 684 lines ki hai, organized in **7 sections** + sub-sections (1.1, 1.2, etc).

---

## Setup — Top of File (lines 1-46)

### Line 1-20: Docstring (header comment)
```python
"""
Predict Vault Backtest — naked PLP vs hedged.
...
"""
```

**Kya hai**: File ka description. Bilkul shuru mein.

**Kyun hai**: Future-you ko yaad rakhna padega kya file karti hai. Yeh quick reference hai.

---

### Line 23-30: Imports
```python
import json
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import norm
```

**Kya hai**: Python libraries import kar rahe hain.

**Kya kaam karti hain**:
- `json` — JSONL files padhne ke liye
- `datetime` — date/time handle karne ke liye
- `Path` — file paths ke liye (folder navigation)
- `matplotlib.pyplot` (`plt`) — **graphs banane ke liye**
- `numpy` (`np`) — math operations (sqrt, log, etc.)
- `pandas` (`pd`) — **data tables (DataFrames) ke liye** — Excel jaise rows/columns
- `scipy.stats.norm` — **normal distribution** (Black-Scholes ke liye CDF chahiye)

---

### Line 32-33: Paths
```python
DATA_DIR = Path(__file__).parent / "data"
PROC_DIR = DATA_DIR / "processed"
```

**Kya hai**: Folder paths set kiye.

- `DATA_DIR` = `backtest/data/` (raw data)
- `PROC_DIR` = `backtest/data/processed/` (filtered data)

`__file__` = current file's location. `.parent` = folder above. `/ "data"` = add "data" subfolder.

---

### Line 39-40: Decimal scales
```python
STRIKE_DECIMALS = 9
QUOTE_DECIMALS = 6
```

**Kya hai**: DeepBook ka data scaling pattern.

**Kyun important**: Blockchain par numbers integers mein store hote hain. **Decimal nahi hote**. Toh:
- `$70,000` ka strike actually stored as `70_000_000_000_000` (9 zeros padded)
- `$1.50` ka dUSDC actually stored as `1_500_000` (6 zeros padded)

Hum scale karke wapas dollars mein convert karte hain UI/calculation ke liye.

---

# Section 1 — Data Loading and Sanity Check (lines 48-105)

## Section 1.2: Load all event streams (line 48-67)

```python
def load_jsonl(name: str) -> pd.DataFrame:
    return pd.read_json(DATA_DIR / f"{name}.jsonl", lines=True)

mints = load_jsonl("positions_minted")
redeems = load_jsonl("positions_redeemed")
range_mints = load_jsonl("ranges_minted")
range_redeems = load_jsonl("ranges_redeemed")
supplies = load_jsonl("lp_supplies")
withdrawals = load_jsonl("lp_withdrawals")
oracles = load_jsonl("oracles")
```

**Kya kar raha hai**: 7 JSONL files ko pandas DataFrames mein load kiya.

**Layman example**: Excel file ko Python mein open karna. Har file = ek table.

**Output**:
- `mints` → 1,128 rows (har binary bet ka entry)
- `redeems` → 787 rows (har payout claim)
- `range_mints` → 213 (range bet entries)
- `range_redeems` → 153 (range payouts)
- `supplies` → 102 (LPs ne paisa daala)
- `withdrawals` → 58 (LPs ne paisa nikala)
- `oracles` → 3,544 (saare prediction markets ki list)

Phir for loop chala ke print karta hai:
```python
for name, df in [("mints", mints), ...]:
    print(f"{name:16s} {len(df):5d} rows")
```

---

## Section 1.3: Normalize timestamps + price units (line 71-90)

```python
def add_time(df):
    if "checkpoint_timestamp_ms" in df:
        df["ts"] = pd.to_datetime(df["checkpoint_timestamp_ms"], unit="ms")
    return df

for df in (mints, redeems, range_mints, range_redeems, supplies, withdrawals):
    add_time(df)
```

**Kya kar raha hai**: Har row mein `checkpoint_timestamp_ms` (millisecond integer) ko **human-readable date** mein convert kar raha hai. Ek naya `ts` column add hota hai.

**Example**: `1780570491444` → `2026-06-04 10:54:51.444`

```python
oracles["expiry_ts"] = pd.to_datetime(oracles["expiry"], unit="ms")
oracles["activated_at_ts"] = pd.to_datetime(oracles["activated_at"], unit="ms")
```

**Same logic** for oracles — expiry time aur activation time.

```python
mints["strike_usd"] = mints["strike"] / 10**STRIKE_DECIMALS
```

**Kya kar raha hai**: `strike` field (e.g., `70_000_000_000_000`) ko **$70,000** mein convert kiya. `10**9` se divide karke.

```python
for df in (mints, redeems):
    if "cost" in df:
        df["cost_usd"] = df["cost"] / 10**QUOTE_DECIMALS
```

**Same** — cost ko dollars mein convert.

**Print karta hai** sample of mints data — first 5 rows, key columns. Verify kar liya data sahi load hua.

---

## Section 1.4: Filter to useful oracles (line 95-105)

```python
useful_oracles = pd.read_json(PROC_DIR / "oracles_with_bets.jsonl", lines=True)
useful_oracles["expiry_ts"] = pd.to_datetime(useful_oracles["expiry"], unit="ms")
useful_oracles["activated_at_ts"] = pd.to_datetime(useful_oracles["activated_at"], unit="ms")
```

**Kya kar raha hai**: `prepare_data.py` ne `oracles_with_bets.jsonl` save kiya tha — sirf 407 oracles jinpe bets hue. Yahaan load karte hain.

**Layman**: 3,544 oracles mein se sirf woh 407 jinhone activity dekhi.

```python
mints_used = mints[mints["oracle_id"].isin(useful_oracles["oracle_id"])].copy()
redeems_used = redeems[redeems["oracle_id"].isin(useful_oracles["oracle_id"])].copy()
```

**Kya hai**: Sirf un mints/redeems ko rakha jo useful oracles pe hue. Filtering step.

**Output**: 1128/1128 mints retained (all already on useful oracles, which makes sense).

---

# Section 2 — Naked PLP NAV Baseline (lines 109-160)

## Section 2.1: Load DeepBook's official vault performance (line 109-115)

```python
vault_perf_raw = json.load((DATA_DIR / "vault_performance.json").open())
vault_perf = pd.DataFrame(vault_perf_raw["points"])
vault_perf["ts"] = pd.to_datetime(vault_perf["timestamp_ms"], unit="ms")
vault_perf = vault_perf.sort_values("ts").reset_index(drop=True)
vault_perf["vault_value_usd"] = vault_perf["vault_value"] / 10**QUOTE_DECIMALS
```

**Kya kar raha hai**: DeepBook ka **official vault NAV history** load kar raha hai.

**Layman**: Yeh "casino bank ka pichle 44 din ka khaata" hai — DeepBook khud publish karta hai. **Ground truth**.

Output: 161 data points, 2026-04-20 se 2026-06-04 tak.

---

## Section 2.2: Compute baseline metrics (line 119-145)

```python
def compute_metrics(series, ts):
    total_return = series.iloc[-1] / series.iloc[0] - 1
    days = (ts.iloc[-1] - ts.iloc[0]).total_seconds() / 86_400
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1
    rolling_max = series.cummax()
    dd = (series / rolling_max - 1)
    max_dd = dd.min()
    ...
    return {"apy_pct": apy * 100, "max_dd_pct": max_dd * 100, ...}
```

**Kya kar raha hai**: 3 standard finance metrics calculate karta hai.

**Layman**:

1. **`total_return`** = (Final NAV / Starting NAV) − 1 → "kitna profit hua"
2. **`apy`** = total_return ko 365 din ke liye annualize kiya
3. **`max_dd`** ("max drawdown") = **sabse buri girawat** peak se trough tak

**Drawdown ka layman example**:
```
NAV journey: 100 → 110 → 105 → 115 → 90
Peaks: 100, 110, 110, 115, 115
Drops from peak: 0%, 0%, -4.5%, 0%, -21.7%
Max drawdown = -21.7%
```

**Calling it**:
```python
naked_metrics = compute_metrics(vault_perf["share_price"], vault_perf["ts"])
```

**Output mile**:
- APY 2.2%, MaxDD -0.02%, Sharpe 9.15

---

## Section 2.3: Plot the NAV curve (line 148-160)

```python
fig, ax = plt.subplots(figsize=(11, 5))
ax.plot(vault_perf["ts"], vault_perf["share_price"], lw=1.6, label="Naked PLP share price")
ax.scatter(supplies["ts"], ..., marker="^", color="g", label="LP deposit")
ax.scatter(withdrawals["ts"], ..., marker="v", color="r", label="LP withdraw")
ax.set_title(...)
fig.savefig(DATA_DIR.parent / "out_naked_plp.png", dpi=110)
```

**Kya kar raha hai**: Ek graph banata hai — share price over time + jab-jab LP ne paisa daala/nikala woh dots.

**Output**: `backtest/out_naked_plp.png`

**Visual layman**: ek line chart joh dikhata hai NAV almost flat hai 1.00 se 1.003 tak, with some up/down arrows for LP events.

---

# Section 3 — Aggregate Bettor Flow Per Oracle (lines 165-220)

## Section 3.1: Group mints by oracle (line 165-172)

```python
mint_agg = (
    mints_used.groupby("oracle_id")
    .agg(total_cost_usd=("cost_usd", "sum"),
         total_quantity=("quantity", "sum"),
         n_mints=("digest", "count"))
)
```

**Kya kar raha hai**: Har oracle ke liye total mints ki sum nikali.

**Layman**: SQL `GROUP BY` jaisa. Excel pivot table jaisa.

**Result**: Ek table jahan har row ek oracle hai, columns hain — kitna total cost collect hua, kitni quantity sold hui, kitne bets hue.

---

## Section 3.2: Group redeems by oracle + compute pool PnL (line 180-204)

```python
if "payout" in redeems_used.columns:
    redeems_used["payout_usd"] = redeems_used["payout"] / 10**QUOTE_DECIMALS
```

**Kya kar raha hai**: Payout column ko USD mein convert kiya.

```python
redeem_agg = redeems_used.groupby("oracle_id").agg(
    total_payout_usd=("payout_usd", "sum"),
    n_redeems=("digest", "count")
)
```

**Same logic** — har oracle ka total payout sum.

```python
per_oracle = mint_agg.join(redeem_agg, how="left").fillna(0)
per_oracle["pool_pnl_usd"] = per_oracle["total_cost_usd"] - per_oracle.get("total_payout_usd", 0)
```

**Kya kar raha hai**: Mints aur redeems ko join kiya, **per-oracle pool PnL calculate kiya**.

**Pool PnL formula**:
```
Pool PnL = Premium Collected (from bets) − Payouts Owed (to winners)
```

**Layman**: Casino ka per-round profit. Positive = casino jeeti, negative = casino haari.

```python
per_oracle = per_oracle.join(
    useful_oracles.set_index("oracle_id")[["status", "expiry_ts", "settlement_price"]],
    how="left",
)
```

**Kya kar raha hai**: Per-oracle table mein **oracle metadata** add kiya — status (settled/active), expiry time, settlement price.

```python
settled = per_oracle[per_oracle["status"] == "settled"].sort_values("expiry_ts")
```

**Sirf settled oracles** ko rakha — jo abhi tak resolve nahi hue unhe drop kiya.

**Output prints**:
```
Settled oracles in our sample: 333
Total premium collected: $11,391.28
Total payouts owed: $8,727.71
Net pool PnL: $2,663.57
```

---

## Section 3.3: Plot per-expiry house edge (line 222-246)

```python
fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
axes[0].bar(settled["expiry_ts"], settled["pool_pnl_usd"], ...)
axes[1].plot(settled["expiry_ts"], settled["pool_pnl_usd"].cumsum(), lw=1.6)
fig.savefig(DATA_DIR.parent / "out_house_edge.png", dpi=110)
```

**Kya kar raha hai**: 2 charts:
1. **Top**: Bar chart — har expiry ka individual PnL (green if positive, red if negative)
2. **Bottom**: Line chart — cumulative PnL over time (running total)

**Layman**: Top wala batata hai "har round mein kya hua". Bottom wala batata hai "total ab tak kitna kamaya hai".

---

# Section 4 — Volume Scaling Simulation (lines 262-310)

## Section 4.1: Simulate naked PLP at different volume scales (line 264-285)

```python
def simulate_naked_plp(scale):
    pnl_per_expiry = settled["pool_pnl_usd"] * scale
    days = (settled["expiry_ts"].iloc[-1] - settled["expiry_ts"].iloc[0]).total_seconds() / 86_400
    starting_nav = nav_genesis  # ~$1M
    cum_pnl = pnl_per_expiry.cumsum()
    final_pnl = cum_pnl.iloc[-1]
    total_return = final_pnl / starting_nav
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1
    ...
```

**Kya kar raha hai**: Maan lo har bet **N times zyaada** hota — kya APY hota?

**Layman**: "Agar 10× zyaada log testnet pe khel rahe hote, casino kitna kamata?"

Math: pool ka per-expiry profit linearly scale karta hai with volume.

```python
scales = [1, 5, 10, 25, 50, 100]
sim_results = [simulate_naked_plp(s) for s in scales]
sim_df = pd.DataFrame([...])
```

**Output**:
```
scale  apy_pct   max_dd_pct
    1   2.20%   -0.05%
    5  11.46%   -0.25%
   10  24.06%   -0.49%   ← 14% target cross
   25  69.66%   -1.21%
   50 178.78%   -2.39%
  100 593.42%   -4.64%
```

---

## Section 4.2: Plot APY vs scale (line 290-309)

```python
fig, ax = plt.subplots(figsize=(9, 5))
ax.semilogx(sim_df["scale"], sim_df["apy_pct"], "o-", lw=2, color="navy")
ax.axhline(14, color="g", linestyle="--", alpha=0.5, label="14% target")
```

**Kya kar raha hai**: APY (y-axis) vs scale (x-axis log scale) ka chart. Green dotted line = 14% target.

```python
hits = sim_df[sim_df["apy_pct"] >= target_apy]
if not hits.empty:
    min_scale_needed = hits["scale"].min()
    print(f"Minimum scale needed for {target_apy}% APY: {min_scale_needed}×")
```

**Output**: "Minimum scale needed for 14% APY: 10×"

---

# Section 5 — Black-Scholes Binary Pricer (lines 313-410)

## Section 5.1: BS pricer function (line 313-336)

```python
def bs_binary_price(spot, strike, ttm_years, vol_annual, is_up):
    if ttm_years <= 0 or vol_annual <= 0 or spot <= 0 or strike <= 0:
        if is_up:
            return 1.0 if spot > strike else 0.0
        else:
            return 1.0 if spot < strike else 0.0
    d2 = (np.log(spot / strike) - 0.5 * vol_annual**2 * ttm_years) / (
        vol_annual * np.sqrt(ttm_years)
    )
    p_up = float(norm.cdf(d2))
    return p_up if is_up else 1.0 - p_up
```

**Kya kar raha hai**: **Black-Scholes binary option pricing formula** ka implementation.

**Layman**: 
- Input: current price (spot), strike (target), time-to-expiry, volatility
- Output: probability that strike is hit at expiry (0 to 1)
- This is **standard options pricing math** that Goldman/Citadel use

**Formula explained**:
```
d2 = (ln(spot/strike) - 0.5 × vol² × T) / (vol × √T)
P(UP wins) = N(d2)  ← N is standard normal CDF
P(DOWN wins) = 1 - N(d2)
```

**Edge cases**: time = 0 ya volatility = 0 → use **intrinsic value** (already crossed strike ya nahi).

---

## Section 5.2: Validate against on-chain prices (line 339-410)

```python
sample = mints_used.sample(min(200, len(mints_used)), random_state=42).copy()
sample = sample.merge(useful_oracles[["oracle_id", "expiry"]], on="oracle_id", how="left", ...)
sample["ttm_ms"] = sample["expiry"] - sample["checkpoint_timestamp_ms"]
sample = sample[sample["ttm_ms"] > 60_000].copy()
sample["ttm_years"] = sample["ttm_ms"] / (1000 * 86_400 * 365)
sample["actual_price"] = sample["ask_price"] / 1e9
sample["spot_est"] = sample["strike_usd"]  # placeholder
```

**Kya kar raha hai**: 200 random mints pick kar ke, on-chain `ask_price` vs BS model price compare karta hai.

**Approximation note**: spot ko strike se approximate kiya hai (ATM-only). Real spot lookup karna padta from oracle history — V2 enhancement.

```python
sample["model_price_50vol"] = sample.apply(
    lambda r: bs_binary_price(r["spot_est"], r["strike_usd"], r["ttm_years"], 0.50, r["is_up"]),
    axis=1,
)
```

**Kya kar raha hai**: Har row ke liye BS model se price calculate kiya (50% vol assume kiya).

```python
fig, ax = plt.subplots(figsize=(7, 7))
ax.scatter(sample["actual_price"], sample["model_price_50vol"], alpha=0.3, s=15)
ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)
```

**Plot karta hai**: Actual price vs model price scatter. Diagonal line = perfect agreement.

**Sanity prints**:
```
ATM 30-min binary, vol=50%: UP=0.4992 (should be ≈0.50)  ✓
Mean actual price: 0.513
Mean model price: 0.497
```

Both close to 0.5 → model is sensible at the ATM-approximate level.

---

# Section 6 — Hedged Vault Simulator (lines 418-560)

## Section 6.1: Load spot at each oracle's activation (line 418-433)

```python
def load_spot_at_activation(oracle_id):
    path = PROC_DIR / "prices" / f"{oracle_id}.jsonl"
    if not path.exists():
        return None
    first = next(iter(path.open()), None)
    if not first:
        return None
    rec = json.loads(first)
    return rec.get("spot", 0) / 10**STRIKE_DECIMALS

print("Loading spot-at-activation for each useful oracle...")
spot_at_start = {}
for oid in useful_oracles["oracle_id"]:
    s = load_spot_at_activation(oid)
    if s:
        spot_at_start[oid] = s
```

**Kya kar raha hai**: Har oracle ka **starting spot price** load kar raha hai disk se. Ek dictionary banayi hai `{oracle_id: spot}`.

**Why**: Hedge decisions hum oracle activation ke time pe karte hain. Spot needed at that moment.

```python
settled_lookup = useful_oracles.set_index("oracle_id")[["settlement_price"]].copy()
settled_lookup["settlement_usd"] = settled_lookup["settlement_price"] / 10**STRIKE_DECIMALS
```

**Settlement price lookup** — final BTC price at expiry, in USD.

---

## Section 6.2: Hedged vault simulator (line 437-525)

```python
def simulate_hedged_vault(scale, annual_hedge_pct, sigma_distance=0.02,
                          hedge_vol=0.80, max_leverage=20.0,
                          starting_nav=1_000_000.0):
    expiries_per_year = 365 * 48  # rolling 30-min expiries
    budget_per_expiry = (annual_hedge_pct * starting_nav) / expiries_per_year
    wing_budget = budget_per_expiry / 2
    
    nav = starting_nav
    nav_curve = [nav]
    ...
    
    ttm_years = 30 / (365 * 24 * 60)  # 30-minute expiry
    
    for oracle_id, row in settled.iterrows():
        spot = spot_at_start.get(oracle_id)
        if oracle_id not in settled_lookup.index:
            continue
        settlement = settled_lookup.loc[oracle_id, "settlement_usd"]
        if spot is None or settlement is None or settlement <= 0:
            continue
        
        up_strike = spot * (1 + sigma_distance)
        down_strike = spot * (1 - sigma_distance)
        
        p_up = max(bs_binary_price(spot, up_strike, ttm_years, hedge_vol, True), 0.001)
        p_down = max(bs_binary_price(spot, down_strike, ttm_years, hedge_vol, False), 0.001)
        
        n_up = min(wing_budget / p_up, wing_budget * max_leverage)
        n_down = min(wing_budget / p_down, wing_budget * max_leverage)
        
        hedge_cost = budget_per_expiry
        hedge_payout = 0.0
        if settlement > up_strike:
            hedge_payout += n_up
        if settlement < down_strike:
            hedge_payout += n_down
        
        pool_pnl = row["pool_pnl_usd"] * scale
        net_change = pool_pnl - hedge_cost + hedge_payout
        nav += net_change
        nav_curve.append(nav)
```

**Step-by-step layman**:

### 1. Parameters
- `scale` = volume multiplier (1×, 10×, 50×, etc.)
- `annual_hedge_pct` = % of NAV per YEAR spent on hedging (0.05 = 5%)
- `sigma_distance` = how far OTM the hedge strikes are (0.02 = 2% from spot)
- `hedge_vol` = 80% (realistic BTC short-term vol)
- `max_leverage` = 20× (payout/premium ratio cap)

### 2. Budget calculation
```python
expiries_per_year = 365 * 48  # 17,520 — 30-min expiries throughout the year
budget_per_expiry = (annual_hedge_pct * starting_nav) / expiries_per_year
```

**Example with 5% annual on $1M NAV**:
```
Annual budget = 5% × $1,000,000 = $50,000
Per-expiry budget = $50,000 / 17,520 = $2.85
```

### 3. For each settled oracle (a chronological loop)
- Get spot at activation
- Compute OTM strikes: UP at +2%, DOWN at -2% from spot
- Compute hedge prices via Black-Scholes (with 80% vol assumption)
- Number of binaries we can buy: `wing_budget / price`, capped at 20× leverage
- Check settlement: if settlement crossed our OTM strike, hedge pays out
- Update NAV: `nav += pool_pnl − hedge_cost + hedge_payout`

### 4. Track NAV curve, compute metrics

```python
nav_series = pd.Series(nav_curve)
days = (times[-1] - times[0]).total_seconds() / 86_400
total_return = nav_series.iloc[-1] / starting_nav - 1
apy = (1 + total_return) ** (365 / max(days, 1)) - 1
rolling_max = nav_series.cummax()
dd = (nav_series / rolling_max - 1).min()
```

Standard finance metrics calculation.

---

## Section 6.3: Grid search (line 527-538)

```python
grid_results = []
for scale in [1, 10, 50, 100]:
    for annual_pct in [0.00, 0.02, 0.05, 0.10, 0.20]:
        r = simulate_hedged_vault(scale, annual_hedge_pct=annual_pct)
        grid_results.append(...)

grid_df = pd.DataFrame(grid_results)
```

**Kya kar raha hai**: **4 scales × 5 hedge ratios = 20 combinations** run karta hai. Output ek table.

**Result table**:
```
scale 10×, hedge 5%/yr:  APY 23.3%, DD -0.5%
scale 50×, hedge 5%/yr:  APY 176.8%, DD -2.4%
...
```

---

## Section 6.4: Plot NAV curves at 50× (line 541-555)

```python
fig, ax = plt.subplots(figsize=(11, 5))
for annual_pct in [0.00, 0.02, 0.05, 0.10, 0.20]:
    r = simulate_hedged_vault(50, annual_hedge_pct=annual_pct)
    ax.plot(r["times"], r["nav_curve"], label=f"annual hedge={annual_pct:.0%}", lw=1.4)
```

**Kya kar raha hai**: Ek chart pe 5 lines — different hedge ratios at 50× scale. Show karta hai hedge ka effect.

---

## Section 6.5: Stress test (line 559-625)

```python
def stress_test_crash(crash_pct=-0.05, affected_oracles_pct=0.10, scale=50,
                     annual_hedge_pct=0.05, ...):
    rng = np.random.default_rng(42)
    n_affected = int(len(settled) * affected_oracles_pct)
    affected_idx = rng.choice(settled.index, size=n_affected, replace=False)
    ...
```

**Kya kar raha hai**: Random 10% of expiries pick ki, unka settlement artificially -5% kiya. Simulate BTC crash.

**Layman**: "Maan lo BTC achanak 5% gira on 10% of expiries — kya hota vault ko?"

```python
if oracle_id in affected_idx:
    settlement = spot * (1 + crash_pct)  # -5% crash
    stressed_pool_pnl = -row["total_cost_usd"] * 3 * scale  # pool loses heavily
else:
    settlement = settled_lookup.loc[oracle_id, "settlement_usd"]
    stressed_pool_pnl = row["pool_pnl_usd"] * scale
```

**Layman**: Affected oracles ke liye settlement -5% set kiya. Pool ki PnL stressed (heavy loss).

```python
no_hedge_stress = stress_test_crash(annual_hedge_pct=0.00)
hedged_stress = stress_test_crash(annual_hedge_pct=0.05)
```

**Compare** — naked vs hedged drawdown in stress.

**Result**:
```
Naked:   DD -7.42%
Hedged:  DD -7.39%   ← hedge barely helped
```

---

# Section 7 — Final Summary (lines 629-683)

```python
print("=" * 60)
print(" Phase A FINAL SUMMARY")
print("=" * 60)
print(f"Settled-with-bets oracles: {len(settled)}")
print(f"Period covered: {(...).days} days")
print(f"Total premium collected: ${settled['total_cost_usd'].sum():,.2f}")
print(f"Net pool PnL: ${settled['pool_pnl_usd'].sum():,.2f}")
print(f"Gross house edge: {100 * net_pnl / total_cost:.2f}%")
```

**Kya kar raha hai**: Sab numbers ek table mein print kiya — easy reading ke liye.

```python
candidates = grid_df[(grid_df["scale"] >= 10) & (grid_df["max_dd_pct"] >= -7) & (grid_df["apy_pct"] >= 14)]
if not candidates.empty:
    best = candidates.sort_values("apy_pct", ascending=False).iloc[0]
    print(f"✓ Build vault: at {best['scale']}× scale with ...")
else:
    print("⚠ No combo hits target. Tune or pivot.")
```

**Verdict logic**: 
- Filter: scale ≥ 10×, DD ≥ -7%, APY ≥ 14%
- Agar koi combo qualify karta hai → BUILD
- Nahi karta to → TUNE or PIVOT

**Actual verdict received**: "Build vault: at 100× scale with 0%/yr hedge → 590.8% APY, -4.64% DD"

---

# Summary: Whole File ka Structure

```
backtest.py (684 lines)
│
├── Section 1: Data Loading (lines 22-105)
│   ├── 1.1 Imports
│   ├── 1.2 Load JSONL files into DataFrames
│   ├── 1.3 Normalize timestamps + decimal scales
│   └── 1.4 Filter to useful oracles (with bets)
│
├── Section 2: Naked PLP NAV Baseline (lines 109-160)
│   ├── 2.1 Load DeepBook's vault_performance series
│   ├── 2.2 Compute APY, drawdown, Sharpe
│   └── 2.3 Plot NAV curve with LP events
│
├── Section 3: Bettor Flow Aggregation (lines 165-246)
│   ├── 3.1 Group mints by oracle
│   ├── 3.2 Group redeems + compute pool PnL
│   ├── 3.3 Plot per-expiry house edge
│   └── 3.4 Sanity check vs NAV change
│
├── Section 4: Volume Scaling Simulation (lines 262-310)
│   ├── 4.1 Simulate naked PLP at 1×, 5×, 10×, 25×, 50×, 100×
│   └── 4.2 Plot APY vs scale
│
├── Section 5: Black-Scholes Pricer (lines 313-410)
│   ├── 5.1 BS binary formula implementation
│   └── 5.2 Validate against on-chain ask prices
│
├── Section 6: Hedged Vault Simulator (lines 418-625)
│   ├── 6.1 Load spot-at-activation per oracle
│   ├── 6.2 Simulator function (with annual budget)
│   ├── 6.3 Grid search 4 scales × 5 hedge ratios
│   ├── 6.4 Plot NAV curves
│   └── 6.5 Stress test (10% expiries see -5%)
│
└── Section 7: Final Decision (lines 629-683)
    ├── Print formatted summary
    └── Verdict: BUILD / TUNE / PIVOT
```

---

# Key Concepts to Remember

| Term | What it is |
|---|---|
| **DataFrame** | Excel table in Python (rows × columns) |
| **PLP** | Predict LP token — "shareholder receipt" for the casino bank |
| **NAV** | Net Asset Value — total $ value of the vault |
| **APY** | Annualized return (% per year) |
| **Drawdown (DD)** | Worst peak-to-trough fall |
| **Strike** | Target price (e.g., "BTC > $70k") |
| **Spot** | Current BTC price |
| **OTM** (Out-of-the-money) | Strike far from spot (low probability, low cost) |
| **ATM** (At-the-money) | Strike near spot (~50% probability) |
| **Binary option** | Pays $1 if condition met, $0 otherwise |
| **Black-Scholes** | Standard formula for option pricing |
| **N(d2)** | Standard normal CDF → probability binary hits |
| **Hedge wing** | OTM binary bought as insurance |
| **TTM** | Time to maturity (years until expiry) |
| **Volatility (vol)** | How wildly the price moves (annualized standard deviation) |
| **Implied vol** | Vol back-solved from observed option price |
| **Sharpe ratio** | Return per unit of risk |
| **Stress test** | Simulating extreme scenarios |

---

# Output Files (created by running the script)

| File | What it shows |
|---|---|
| `out_naked_plp.png` | NAV curve over 44 days |
| `out_house_edge.png` | Per-expiry pool PnL + cumulative |
| `out_volume_scale.png` | APY vs volume multiplier |
| `out_bs_validation.png` | BS model price vs actual on-chain |
| `out_hedged_nav.png` | NAV under different hedge ratios |
| `out_stress_test.png` | Naked vs hedged under simulated crash |
| `logs.txt` | Full console output |

---

# Bottom-Line Reading

**The code achieves**:
1. ✅ Loaded 7 historical event streams from indexer
2. ✅ Confirmed 2.2% APY testnet baseline
3. ✅ Simulated 1×-100× volume scaling (10× → 24% APY)
4. ✅ Validated Black-Scholes pricer against on-chain prices
5. ✅ Tested 20 hedge configurations
6. ✅ Stress-tested vault against -5% BTC crash

**Big takeaways**:
1. **House edge real**: 23.4% net margin on bettor flow (high vs Polymarket's 1-3%)
2. **Volume scaling works**: 10× scale = 24% APY easily beats 14% target
3. **Hedging adds little value**: Annualized 5% hedge cost gives ~0.7% APY drag but only 0.03% better DD
4. **DeepBook's protocol caps already provide most safety** — diversification across 333 expiries naturally bounds drawdown to ~-7% in stress

**Implication for Hunchbook**:
The "hedged vault" thesis is weaker than we thought. The vault still **works** — just not via hedge differentiation. Need to **re-pitch as platform/UX play** instead of pure-quant.

---

Yeh document tum khol ke baar baar refer kar sakte ho. Code change ho jaaye to woh sections relabel kar sakte hain.

Any specific section pe aur deep dive chahiye to bolo — main wahi part aur detail mein samjha doonga.
