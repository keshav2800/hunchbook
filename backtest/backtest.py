"""
Predict Vault Backtest — naked PLP vs hedged.

This is a "percent cell" Python file. In VS Code, install the Python extension
and the cells (delimited by # %%) become runnable like a Jupyter notebook.
You can also run it end-to-end with:
    .venv/bin/python3 backtest.py

What it does, top to bottom:
  Section 1 — load data and sanity-check
  Section 2 — naked PLP NAV from indexer's vault_performance series
  Section 3 — aggregate bettor flow per oracle (house-edge per expiry)
  Section 4 — volume-scale simulation (1x to 100x testnet activity)
  Section 5 — Black-Scholes binary pricer + validation against on-chain prices
  Section 6 — hedged-vault simulator (grid search hedge_pct × sigma × scale)
  Section 7 — decision summary

Run sections 1-3 first; they only need the event files. Sections 5-6 also need
data/processed/svi/ and data/processed/prices/ (produced by prepare_data.py).
"""

# %% Section 1.1 — Imports + paths
import json
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import norm

DATA_DIR = Path(__file__).parent / "data"
PROC_DIR = DATA_DIR / "processed"

# Predict protocol amounts are stored at 9 decimals on-chain. The dUSDC
# quote asset uses 6 decimals. Strikes / spot are reported in 9-decimal units
# (so a $70,000 strike is 70_000_000_000_000). Costs / payouts are in 6-decimal
# dUSDC (so $1.00 is 1_000_000). Keep these constants close at hand.
STRIKE_DECIMALS = 9
QUOTE_DECIMALS = 6

# Per-mint quantity is in 6-decimal dUSDC equivalent — qty=1_000_000 means
# the bettor pays cost dUSDC to win up to $1 if the strike is hit.

print("DATA_DIR:", DATA_DIR)
print("PROC_DIR:", PROC_DIR)

# %% Section 1.2 — Load event streams
def load_jsonl(name: str) -> pd.DataFrame:
    return pd.read_json(DATA_DIR / f"{name}.jsonl", lines=True)


mints = load_jsonl("positions_minted")
redeems = load_jsonl("positions_redeemed")
range_mints = load_jsonl("ranges_minted")
range_redeems = load_jsonl("ranges_redeemed")
supplies = load_jsonl("lp_supplies")
withdrawals = load_jsonl("lp_withdrawals")
oracles = load_jsonl("oracles")

for name, df in [
    ("mints", mints),
    ("redeems", redeems),
    ("range_mints", range_mints),
    ("range_redeems", range_redeems),
    ("supplies", supplies),
    ("withdrawals", withdrawals),
    ("oracles", oracles),
]:
    print(f"{name:16s} {len(df):5d} rows")


# %% Section 1.3 — Normalize timestamps + price units
def add_time(df: pd.DataFrame) -> pd.DataFrame:
    if "checkpoint_timestamp_ms" in df:
        df["ts"] = pd.to_datetime(df["checkpoint_timestamp_ms"], unit="ms")
    return df


for df in (mints, redeems, range_mints, range_redeems, supplies, withdrawals):
    add_time(df)

oracles["expiry_ts"] = pd.to_datetime(oracles["expiry"], unit="ms")
oracles["activated_at_ts"] = pd.to_datetime(oracles["activated_at"], unit="ms")

# Convenience: strike in dollars
if "strike" in mints:
    mints["strike_usd"] = mints["strike"] / 10**STRIKE_DECIMALS
if "strike" in oracles:
    oracles["min_strike_usd"] = oracles["min_strike"] / 10**STRIKE_DECIMALS

# Cost in dollars
for df in (mints, redeems):
    if "cost" in df:
        df["cost_usd"] = df["cost"] / 10**QUOTE_DECIMALS

print("\nMint head:")
print(mints[["ts", "oracle_id", "is_up", "strike_usd", "quantity", "cost_usd"]].head())

# %% Section 1.4 — Useful subset of oracles
useful_oracles = pd.read_json(PROC_DIR / "oracles_with_bets.jsonl", lines=True)
useful_oracles["expiry_ts"] = pd.to_datetime(useful_oracles["expiry"], unit="ms")
useful_oracles["activated_at_ts"] = pd.to_datetime(useful_oracles["activated_at"], unit="ms")
print(f"\nUseful oracles (had ≥1 bet): {len(useful_oracles)}")
print(useful_oracles["status"].value_counts())

# Filter all bet events to only the useful oracles (sanity — should be no-op)
mints_used = mints[mints["oracle_id"].isin(useful_oracles["oracle_id"])].copy()
redeems_used = redeems[redeems["oracle_id"].isin(useful_oracles["oracle_id"])].copy()
print(f"Mints on useful oracles:   {len(mints_used)} / {len(mints)}")
print(f"Redeems on useful oracles: {len(redeems_used)} / {len(redeems)}")

# %% Section 2.1 — Load vault performance series (ground truth NAV curve)
vault_perf_raw = json.load((DATA_DIR / "vault_performance.json").open())
vault_perf = pd.DataFrame(vault_perf_raw["points"])
vault_perf["ts"] = pd.to_datetime(vault_perf["timestamp_ms"], unit="ms")
vault_perf = vault_perf.sort_values("ts").reset_index(drop=True)
vault_perf["vault_value_usd"] = vault_perf["vault_value"] / 10**QUOTE_DECIMALS
print(f"Vault perf series: {len(vault_perf)} points, "
      f"{vault_perf['ts'].iloc[0]:%Y-%m-%d} → {vault_perf['ts'].iloc[-1]:%Y-%m-%d}")
print(vault_perf[["ts", "share_price", "vault_value_usd"]].head())

# %% Section 2.2 — Compute baseline (naked PLP) metrics + plot NAV curve
def compute_metrics(series: pd.Series, ts: pd.Series) -> dict:
    """Annualized return, max drawdown, simple Sharpe (no risk-free)."""
    if len(series) < 2:
        return {}
    total_return = series.iloc[-1] / series.iloc[0] - 1
    days = (ts.iloc[-1] - ts.iloc[0]).total_seconds() / 86_400
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1
    # Max drawdown: peak-to-trough on share_price walk
    rolling_max = series.cummax()
    dd = (series / rolling_max - 1)
    max_dd = dd.min()
    # Simple daily return Sharpe
    daily = series.resample("D", on=None).last() if isinstance(series.index, pd.DatetimeIndex) else None
    if daily is None:
        tmp = pd.DataFrame({"v": series, "ts": ts}).set_index("ts").resample("D").last()["v"].dropna()
        rets = tmp.pct_change().dropna()
    else:
        rets = daily.pct_change().dropna()
    sharpe = (rets.mean() / rets.std() * np.sqrt(365)) if len(rets) > 1 and rets.std() > 0 else float("nan")
    return {
        "days": days,
        "total_return_pct": total_return * 100,
        "apy_pct": apy * 100,
        "max_dd_pct": max_dd * 100,
        "sharpe": sharpe,
    }


naked_metrics = compute_metrics(vault_perf["share_price"], vault_perf["ts"])
print("\nNaked PLP (1x testnet activity) metrics:")
for k, v in naked_metrics.items():
    print(f"  {k}: {v:.4f}")

# %% Section 2.3 — Plot naked PLP NAV with LP-event annotations
fig, ax = plt.subplots(figsize=(11, 5))
ax.plot(vault_perf["ts"], vault_perf["share_price"], lw=1.6, label="Naked PLP share price")
# Mark LP supply (deposits) and withdrawals
ax.scatter(supplies["ts"], np.interp(supplies["ts"].astype(np.int64),
                                     vault_perf["ts"].astype(np.int64),
                                     vault_perf["share_price"]),
           marker="^", color="g", s=20, alpha=0.5, label="LP deposit")
ax.scatter(withdrawals["ts"], np.interp(withdrawals["ts"].astype(np.int64),
                                        vault_perf["ts"].astype(np.int64),
                                        vault_perf["share_price"]),
           marker="v", color="r", s=20, alpha=0.5, label="LP withdraw")
ax.set_title(f"Naked PLP share price — testnet ground truth "
             f"(APY {naked_metrics['apy_pct']:.2f}%, "
             f"MaxDD {naked_metrics['max_dd_pct']:.2f}%)")
ax.set_xlabel("Date")
ax.set_ylabel("Share price (1.0 = genesis)")
ax.legend()
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_naked_plp.png", dpi=110)
print("\nSaved naked PLP chart to backtest/out_naked_plp.png")

# %% Section 3.1 — Aggregate bettor flow per oracle
# For each (oracle, side) compute total premium collected + total payout owed.
mint_agg = (
    mints_used.groupby("oracle_id")
    .agg(total_cost_usd=("cost_usd", "sum"),
         total_quantity=("quantity", "sum"),
         n_mints=("digest", "count"))
)

# Redeem events have a `payout` field too — but let's check the columns first
print("Redeem columns:", redeems.columns.tolist())
print(redeems.head(2).to_string())

# %% Section 3.2 — Per-oracle PnL from bets (pool's perspective)
# House PnL = premium collected − payouts owed
if "payout" in redeems_used.columns:
    redeems_used["payout_usd"] = redeems_used["payout"] / 10**QUOTE_DECIMALS
elif "amount_out" in redeems_used.columns:
    redeems_used["payout_usd"] = redeems_used["amount_out"] / 10**QUOTE_DECIMALS

payout_col = "payout_usd" if "payout_usd" in redeems_used.columns else None
if payout_col:
    redeem_agg = (
        redeems_used.groupby("oracle_id")
        .agg(total_payout_usd=(payout_col, "sum"),
             n_redeems=("digest", "count"))
    )
else:
    print("WARNING: could not find payout column in redeem events. "
          "Pool PnL estimation will be approximate.")
    redeem_agg = pd.DataFrame(columns=["total_payout_usd", "n_redeems"])

per_oracle = mint_agg.join(redeem_agg, how="left").fillna(0)
per_oracle["pool_pnl_usd"] = per_oracle["total_cost_usd"] - per_oracle.get("total_payout_usd", 0)

# Join with oracle metadata for time-sort + status
per_oracle = per_oracle.join(
    useful_oracles.set_index("oracle_id")[["status", "expiry_ts", "settlement_price"]],
    how="left",
)
per_oracle["settlement_price_usd"] = per_oracle["settlement_price"] / 10**STRIKE_DECIMALS

settled = per_oracle[per_oracle["status"] == "settled"].sort_values("expiry_ts")
print(f"\nSettled oracles in our sample: {len(settled)}")
print(f"Total premium collected:  ${settled['total_cost_usd'].sum():,.2f}")
print(f"Total payouts owed:       ${settled.get('total_payout_usd', pd.Series(dtype=float)).sum():,.2f}")
print(f"Net pool PnL:             ${settled['pool_pnl_usd'].sum():,.2f}")
print(f"Avg PnL per expiry:       ${settled['pool_pnl_usd'].mean():,.4f}")
print(f"# expiries with positive: {(settled['pool_pnl_usd'] > 0).sum()}")
print(f"# expiries with negative: {(settled['pool_pnl_usd'] < 0).sum()}")

# %% Section 3.3 — Plot per-expiry house edge + cumulative PnL
fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
axes[0].bar(settled["expiry_ts"], settled["pool_pnl_usd"], width=0.02, color=
            ["g" if p > 0 else "r" for p in settled["pool_pnl_usd"]])
axes[0].axhline(0, color="k", lw=0.8)
axes[0].set_ylabel("Per-expiry pool PnL (USD)")
axes[0].set_title("House edge per expiry (positive = pool won)")
axes[0].grid(alpha=0.3)

axes[1].plot(settled["expiry_ts"], settled["pool_pnl_usd"].cumsum(), lw=1.6, color="navy")
axes[1].set_ylabel("Cumulative pool PnL (USD)")
axes[1].set_xlabel("Expiry date")
axes[1].grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_house_edge.png", dpi=110)
print("Saved house-edge chart to backtest/out_house_edge.png")

# %% Section 3.4 — Sanity check: cumulative PnL should match vault NAV delta
total_pool_pnl = settled["pool_pnl_usd"].sum()
nav_genesis = vault_perf["vault_value_usd"].iloc[0]
nav_now = vault_perf["vault_value_usd"].iloc[-1]
# Adjust for LP supply/withdrawals — only "earned" value should match bet PnL
lp_net_supplied = (
    (supplies["quantity"].sum() if "quantity" in supplies else 0)
    - (withdrawals["quantity"].sum() if "quantity" in withdrawals else 0)
) / 10**QUOTE_DECIMALS
inferred_earned = (nav_now - nav_genesis) - (lp_net_supplied - nav_genesis * 0)  # crude

print(f"\nVault NAV change:        ${nav_now - nav_genesis:,.2f}")
print(f"Sum of per-expiry PnL:   ${total_pool_pnl:,.2f}")
print("(These won't match exactly because LP supply/withdrawal also moves NAV,")
print(" and some expiries are still unsettled. Order of magnitude is what matters.)")

# %% Section 4.1 — Volume-scale simulation
# At each scale, recompute as if every historical bet was multiplied in size.
# The pool's per-expiry PnL scales linearly (premium scales, payout scales).
def simulate_naked_plp(scale: float) -> dict:
    pnl_per_expiry = settled["pool_pnl_usd"] * scale
    days = (settled["expiry_ts"].iloc[-1] - settled["expiry_ts"].iloc[0]).total_seconds() / 86_400
    # Cumulative as % of starting NAV
    starting_nav = nav_genesis  # ~$1M
    cum_pnl = pnl_per_expiry.cumsum()
    final_pnl = cum_pnl.iloc[-1]
    total_return = final_pnl / starting_nav
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1
    nav_curve = starting_nav + cum_pnl
    rolling_max = nav_curve.cummax()
    dd = (nav_curve / rolling_max - 1).min()
    return {"scale": scale, "apy_pct": apy * 100, "max_dd_pct": dd * 100,
            "final_pnl_usd": final_pnl, "nav_curve": nav_curve}


scales = [1, 5, 10, 25, 50, 100]
sim_results = [simulate_naked_plp(s) for s in scales]
sim_df = pd.DataFrame([{k: v for k, v in r.items() if k != "nav_curve"} for r in sim_results])
print(sim_df.to_string(index=False, float_format=lambda x: f"{x:,.4f}"))

# %% Section 4.2 — Plot naked-PLP APY vs volume scale
fig, ax = plt.subplots(figsize=(9, 5))
ax.semilogx(sim_df["scale"], sim_df["apy_pct"], "o-", lw=2, color="navy")
ax.axhline(14, color="g", linestyle="--", alpha=0.5, label="14% target")
ax.axhline(0, color="k", lw=0.5)
ax.set_xlabel("Volume scale (× testnet activity)")
ax.set_ylabel("Annualized return (%)")
ax.set_title("Naked PLP APY at scaled volume (no hedging)")
ax.legend()
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_volume_scale.png", dpi=110)
print("\nSaved volume-scale chart to backtest/out_volume_scale.png")

# Decision gate so far — print verdict on Section 4
target_apy = 14
hits = sim_df[sim_df["apy_pct"] >= target_apy]
if not hits.empty:
    min_scale_needed = hits["scale"].min()
    print(f"\nMinimum scale needed for {target_apy}% APY (naked, no hedge): {min_scale_needed}×")
else:
    print(f"\n⚠ Even at 100× scale, naked PLP doesn't hit {target_apy}% APY. "
          "Need to revisit either the model or the target.")

# %% Section 5.1 — Black-Scholes binary pricer
# Cash-or-nothing binary option: pays $1 if condition met at expiry, else $0.
#   d2 = (ln(S/K) - 0.5 * sigma^2 * T) / (sigma * sqrt(T))
#   UP_price   = N(d2)
#   DOWN_price = N(-d2) = 1 - N(d2)
# We assume zero rate / no funding (Sui dUSDC is stable, sub-hour expiries
# make the rate term negligible).
def bs_binary_price(spot: float, strike: float, ttm_years: float,
                    vol_annual: float, is_up: bool) -> float:
    if ttm_years <= 0 or vol_annual <= 0 or spot <= 0 or strike <= 0:
        # Degenerate cases — return intrinsic
        if is_up:
            return 1.0 if spot > strike else 0.0
        else:
            return 1.0 if spot < strike else 0.0
    d2 = (np.log(spot / strike) - 0.5 * vol_annual**2 * ttm_years) / (
        vol_annual * np.sqrt(ttm_years)
    )
    p_up = float(norm.cdf(d2))
    return p_up if is_up else 1.0 - p_up


# Quick sanity check: at-the-money should price near 0.5
spot_test, strike_test, ttm_test, vol_test = 70_000, 70_000, 30 / (365 * 24 * 60), 0.50
print(f"ATM 30-min binary, vol=50%: UP={bs_binary_price(spot_test, strike_test, ttm_test, vol_test, True):.4f} "
      f"(should be ≈0.50)")
print(f"OTM +1%   30-min, vol=50%: UP={bs_binary_price(spot_test, 70_700, ttm_test, vol_test, True):.4f}")
print(f"OTM -1%   30-min, vol=50%: DOWN={bs_binary_price(spot_test, 69_300, ttm_test, vol_test, False):.4f}")

# %% Section 5.2 — Validate BS model against actual on-chain ask prices
# Take a sample of historical mints. For each: compute model price using
# the observed ask, back-solve the implied vol, see if it's a reasonable range.
# On-chain `ask_price` is at 9-decimal scale (1.0 = 1e9), per-unit of quantity.
sample = mints_used.sample(min(200, len(mints_used)), random_state=42).copy()
sample = sample.merge(
    useful_oracles[["oracle_id", "expiry"]],
    on="oracle_id", how="left", suffixes=("", "_o"),
)
# Activation time: we use the mint's own timestamp as proxy (good enough for IV)
sample["ttm_ms"] = sample["expiry"] - sample["checkpoint_timestamp_ms"]
sample = sample[sample["ttm_ms"] > 60_000].copy()  # >1 min to expiry
sample["ttm_years"] = sample["ttm_ms"] / (1000 * 86_400 * 365)
sample["actual_price"] = sample["ask_price"] / 1e9  # ask_price has 9 decimals

# Use spot from same checkpoint — approximate with strike for ATM-ish bets, or
# pull from processed prices. For sanity, we use the strike (works fine for ATM).
# A proper version would look up spot at the mint timestamp from oracle_history.
sample["spot_est"] = sample["strike_usd"]  # placeholder — refine in section 5.3

# Back-solve implied vol with bisection
def implied_vol(price: float, spot: float, strike: float,
                ttm_years: float, is_up: bool) -> float:
    if price <= 0 or price >= 1 or spot == strike:
        return float("nan")
    lo, hi = 0.01, 5.0
    for _ in range(50):
        mid = (lo + hi) / 2
        p = bs_binary_price(spot, strike, ttm_years, mid, is_up)
        if p > price:
            hi = mid if is_up else (mid if (spot > strike) else hi)  # crude
            if is_up:
                hi = mid
            else:
                lo = mid
        else:
            if is_up:
                lo = mid
            else:
                hi = mid
        if hi - lo < 1e-4:
            break
    return (lo + hi) / 2


# For the simple validation we'll just plot model vs actual at vol=50% (BTC norm)
sample["model_price_50vol"] = sample.apply(
    lambda r: bs_binary_price(r["spot_est"], r["strike_usd"], r["ttm_years"], 0.50, r["is_up"]),
    axis=1,
)
fig, ax = plt.subplots(figsize=(7, 7))
ax.scatter(sample["actual_price"], sample["model_price_50vol"], alpha=0.3, s=15)
ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5)
ax.set_xlabel("Actual on-chain price")
ax.set_ylabel("BS model price (vol=50%)")
ax.set_title("BS vs actual prices (ATM-approximated, vol=50%)\n"
             "Points off the diagonal indicate vol or moneyness differences")
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_bs_validation.png", dpi=110)
print("\nSaved BS validation chart to backtest/out_bs_validation.png")
print(f"  Sample size: {len(sample)}")
print(f"  Mean actual price: {sample['actual_price'].mean():.3f}")
print(f"  Mean model price:  {sample['model_price_50vol'].mean():.3f}")

# %% Section 6.1 — Helper: load per-oracle spot history once into a dict
# For Section 6's hedge simulator we need spot at expiry-start for each oracle
# to know where the strikes land.
def load_spot_at_activation(oracle_id: str) -> float | None:
    """Pull the first observed spot for an oracle (closest to activation)."""
    path = PROC_DIR / "prices" / f"{oracle_id}.jsonl"
    if not path.exists():
        return None
    first = next(iter(path.open()), None)
    if not first:
        return None
    rec = json.loads(first)
    return rec.get("spot", 0) / 10**STRIKE_DECIMALS


# Build a dictionary {oracle_id: spot_at_activation_usd}
print("\nLoading spot-at-activation for each useful oracle...")
spot_at_start = {}
for oid in useful_oracles["oracle_id"]:
    s = load_spot_at_activation(oid)
    if s:
        spot_at_start[oid] = s
print(f"Loaded {len(spot_at_start)} oracles' starting spot")

# Settlement price comes from oracles table
settled_lookup = useful_oracles.set_index("oracle_id")[["settlement_price"]].copy()
settled_lookup["settlement_usd"] = settled_lookup["settlement_price"] / 10**STRIKE_DECIMALS

# %% Section 6.2 — Hedged vault simulator (v2 — annualized budget semantics)
#
# Important rewrite notes vs v1:
#   - `annual_hedge_pct` is % of NAV spent on hedges PER YEAR (not per expiry).
#     With ~48 expiries/day on testnet, per-expiry spend = annual_pct / 17,520.
#   - `hedge_vol = 0.80` — BTC short-term realized vol is ~70-100% annualized,
#     not the 0.50 v1 used (that drastically under-priced OTM tails).
#   - We cap each wing's notional payout at `max_leverage × premium` to prevent
#     the BS model from giving us absurd lottery-ticket leverage.
def simulate_hedged_vault(
    scale: float,
    annual_hedge_pct: float,        # e.g., 0.05 = 5% of NAV/year on hedge premium
    sigma_distance: float = 0.02,   # OTM wings at ±2% from spot
    hedge_vol: float = 0.80,        # realistic BTC short-term IV assumption
    max_leverage: float = 20.0,     # cap on payout/premium ratio per wing
    starting_nav: float = 1_000_000.0,
) -> dict:
    """
    Walk through each settled expiry in time order.

    Each expiry, vault buys a small OTM strangle. Premium is bounded by
    annual budget / expected number of expiries in the year. If hedge wing
    is hit at settlement, vault collects min(notional, max_leverage × premium).
    """
    expiries_per_year = 365 * 48  # rolling 30-min expiries
    budget_per_expiry = (annual_hedge_pct * starting_nav) / expiries_per_year
    wing_budget = budget_per_expiry / 2  # split 50/50 UP/DOWN

    nav = starting_nav
    nav_curve = [nav]
    times = [settled["expiry_ts"].iloc[0]]
    hedge_costs_total = 0.0
    hedge_payouts_total = 0.0
    pool_pnl_total = 0.0

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

        # Notional payout if wing hits (uncapped would be wing_budget / p),
        # but we cap leverage at max_leverage × premium.
        n_up = min(wing_budget / p_up, wing_budget * max_leverage)
        n_down = min(wing_budget / p_down, wing_budget * max_leverage)

        hedge_cost = budget_per_expiry  # premium paid up front
        hedge_payout = 0.0
        if settlement > up_strike:
            hedge_payout += n_up
        if settlement < down_strike:
            hedge_payout += n_down

        pool_pnl = row["pool_pnl_usd"] * scale
        net_change = pool_pnl - hedge_cost + hedge_payout
        nav += net_change

        nav_curve.append(nav)
        times.append(row["expiry_ts"])
        hedge_costs_total += hedge_cost
        hedge_payouts_total += hedge_payout
        pool_pnl_total += pool_pnl

    nav_series = pd.Series(nav_curve)
    days = (times[-1] - times[0]).total_seconds() / 86_400
    total_return = nav_series.iloc[-1] / starting_nav - 1
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1 if total_return > -1 else -1
    rolling_max = nav_series.cummax()
    dd = (nav_series / rolling_max - 1).min()

    return {
        "scale": scale,
        "annual_hedge_pct": annual_hedge_pct,
        "sigma_distance": sigma_distance,
        "apy_pct": apy * 100,
        "max_dd_pct": dd * 100,
        "final_nav": nav_series.iloc[-1],
        "total_pool_pnl": pool_pnl_total,
        "total_hedge_cost": hedge_costs_total,
        "total_hedge_payout": hedge_payouts_total,
        "net_hedge_drag": (hedge_payouts_total - hedge_costs_total),
        "nav_curve": nav_series,
        "times": times,
    }


# %% Section 6.2b — Dynamic hedge sizing simulator
#
# Testnet utilization is tiny (~0.18%), so naive step-function on real utilization
# never activates. To realistically test the dynamic strategy, we synthesize a
# mainnet-like utilization distribution per expiry: most quiet, some active,
# rare concentrated-risk events. The step function then has signal to react to.
def synthesize_mainnet_utilization(n_expiries: int, rng_seed: int = 42) -> np.ndarray:
    """
    Per-expiry utilization that mimics what we'd expect at full mainnet activity:
      70% of expiries: 5-15% utilization  (normal bettor flow)
      25% of expiries: 20-40% utilization (active flow)
       5% of expiries: 50-70% utilization (whale concentration)
    """
    rng = np.random.default_rng(rng_seed)
    out = np.empty(n_expiries)
    bucket = rng.choice(["quiet", "active", "stressed"],
                        size=n_expiries, p=[0.70, 0.25, 0.05])
    for i, b in enumerate(bucket):
        if b == "quiet":
            out[i] = rng.uniform(0.05, 0.15)
        elif b == "active":
            out[i] = rng.uniform(0.20, 0.40)
        else:
            out[i] = rng.uniform(0.50, 0.70)
    return out


def dynamic_hedge_pct(utilization: float) -> float:
    """Step-function dynamic hedge sizing — annual budget %, given current util."""
    if utilization < 0.05:
        return 0.01   # 1% — quiet, minimal premium drag
    if utilization < 0.20:
        return 0.03   # 3% — normal flow, modest insurance
    if utilization < 0.50:
        return 0.08   # 8% — active flow, meaningful protection
    return 0.15       # 15% — concentrated risk, heavy insurance


def simulate_dynamic_hedge(
    scale: float,
    utilizations: np.ndarray,        # per-expiry utilization signal
    sigma_distance: float = 0.02,
    hedge_vol: float = 0.80,
    max_leverage: float = 20.0,
    starting_nav: float = 1_000_000.0,
) -> dict:
    """
    Same vault loop as fixed-hedge simulator, but hedge budget recomputed per
    expiry from the synthesized utilization signal via `dynamic_hedge_pct`.
    """
    expiries_per_year = 365 * 48
    nav = starting_nav
    nav_curve = [nav]
    times = [settled["expiry_ts"].iloc[0]]
    hedge_costs_total = 0.0
    hedge_payouts_total = 0.0
    pool_pnl_total = 0.0
    hedge_pct_history = []

    ttm_years = 30 / (365 * 24 * 60)

    for i, (oracle_id, row) in enumerate(settled.iterrows()):
        spot = spot_at_start.get(oracle_id)
        if oracle_id not in settled_lookup.index:
            continue
        settlement = settled_lookup.loc[oracle_id, "settlement_usd"]
        if spot is None or settlement is None or settlement <= 0:
            continue

        # Look up utilization for this expiry index (cap if mismatch)
        util = utilizations[min(i, len(utilizations) - 1)]
        annual_pct = dynamic_hedge_pct(util)
        hedge_pct_history.append(annual_pct)
        budget_per_expiry = (annual_pct * starting_nav) / expiries_per_year
        wing_budget = budget_per_expiry / 2

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
        nav += pool_pnl - hedge_cost + hedge_payout
        nav_curve.append(nav)
        times.append(row["expiry_ts"])
        hedge_costs_total += hedge_cost
        hedge_payouts_total += hedge_payout
        pool_pnl_total += pool_pnl

    nav_series = pd.Series(nav_curve)
    days = (times[-1] - times[0]).total_seconds() / 86_400
    total_return = nav_series.iloc[-1] / starting_nav - 1
    apy = (1 + total_return) ** (365 / max(days, 1)) - 1 if total_return > -1 else -1
    rolling_max = nav_series.cummax()
    dd = (nav_series / rolling_max - 1).min()
    avg_hedge = float(np.mean(hedge_pct_history)) if hedge_pct_history else 0.0

    return {
        "scale": scale,
        "strategy": "dynamic",
        "apy_pct": apy * 100,
        "max_dd_pct": dd * 100,
        "final_nav": nav_series.iloc[-1],
        "total_hedge_cost": hedge_costs_total,
        "total_hedge_payout": hedge_payouts_total,
        "net_hedge_drag": (hedge_payouts_total - hedge_costs_total),
        "avg_hedge_pct": avg_hedge,
        "nav_curve": nav_series,
        "times": times,
    }


# %% Section 6.2c — Dynamic vs fixed comparison
print("\nDynamic-hedge comparison vs fixed hedge at scale=50×...")
n_expiries_useful = sum(
    1 for oid, _ in settled.iterrows()
    if oid in spot_at_start and oid in settled_lookup.index
    and settled_lookup.loc[oid, "settlement_usd"] > 0
)
synth_utils = synthesize_mainnet_utilization(n_expiries_useful)
print(f"  Synthesized utilization: mean={synth_utils.mean():.2%}  "
      f"p95={np.percentile(synth_utils, 95):.2%}  "
      f"max={synth_utils.max():.2%}")

compare = []
compare.append({**{k: v for k, v in simulate_hedged_vault(50, 0.00).items()
                   if k not in ("nav_curve", "times")},
                "strategy": "naked"})
compare.append({**{k: v for k, v in simulate_hedged_vault(50, 0.02).items()
                   if k not in ("nav_curve", "times")},
                "strategy": "fixed 2%"})
compare.append({**{k: v for k, v in simulate_hedged_vault(50, 0.05).items()
                   if k not in ("nav_curve", "times")},
                "strategy": "fixed 5%"})
compare.append({**{k: v for k, v in simulate_dynamic_hedge(50, synth_utils).items()
                   if k not in ("nav_curve", "times")},
                "strategy": "dynamic"})

print("\nStrategy comparison at scale=50× under synthesized mainnet utilization:\n")
cmp_df = pd.DataFrame(compare)
print(cmp_df[["strategy", "apy_pct", "max_dd_pct", "net_hedge_drag"]]
      .to_string(index=False, float_format=lambda x: f"{x:,.4f}"))

# Stress comparison happens at the end of the file — needs stress_test_crash
# from Section 6.5. Search for "STRESS COMPARISON ACROSS STRATEGIES" below.

# %% Section 6.3 — Grid search annual_hedge_pct × scale
print("\nRunning hedged-vault grid search (annual budget semantics)...")
grid_results = []
for scale in [1, 10, 50, 100]:
    for annual_pct in [0.00, 0.02, 0.05, 0.10, 0.20]:
        r = simulate_hedged_vault(scale, annual_hedge_pct=annual_pct)
        grid_results.append({k: v for k, v in r.items()
                             if k not in ("nav_curve", "times")})

grid_df = pd.DataFrame(grid_results)
print("\nHedged Vault — APY and Drawdown at 2% OTM wings (annual budget):\n")
print(grid_df.to_string(index=False, float_format=lambda x: f"{x:,.4f}"))

# %% Section 6.4 — Plot NAV curves at 50× scale across hedge ratios
fig, ax = plt.subplots(figsize=(11, 5))
for annual_pct in [0.00, 0.02, 0.05, 0.10, 0.20]:
    r = simulate_hedged_vault(50, annual_hedge_pct=annual_pct)
    ax.plot(r["times"], r["nav_curve"],
            label=f"annual hedge={annual_pct:.0%} (APY {r['apy_pct']:.1f}%, DD {r['max_dd_pct']:.1f}%)",
            lw=1.4)
ax.set_xlabel("Date")
ax.set_ylabel("Vault NAV (USD)")
ax.set_title("Vault NAV @ 50× volume scale — varying hedge ratio")
ax.legend(fontsize=9)
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_hedged_nav.png", dpi=110)
print("\nSaved hedged NAV curves to backtest/out_hedged_nav.png")

# %% Section 6.5 — Stress test: inject a synthetic BTC crash
def stress_test_crash(
    crash_pct: float = -0.05,
    affected_oracles_pct: float = 0.10,
    scale: float = 50,
    annual_hedge_pct: float = 0.05,
    hedge_vol: float = 0.80,
    max_leverage: float = 20.0,
) -> dict:
    """
    Pick a random subset of expiries and pretend their settlement price was
    `crash_pct` below their starting spot. This simulates a sudden BTC drop
    that catches some live expiries.
    """
    rng = np.random.default_rng(42)
    n_affected = int(len(settled) * affected_oracles_pct)
    affected_idx = rng.choice(settled.index, size=n_affected, replace=False)

    expiries_per_year = 365 * 48
    budget_per_expiry = (annual_hedge_pct * 1_000_000) / expiries_per_year
    wing_budget = budget_per_expiry / 2
    ttm_years = 30 / (365 * 24 * 60)

    nav = 1_000_000.0
    nav_curve = [nav]
    times = [settled["expiry_ts"].iloc[0]]

    for oracle_id, row in settled.iterrows():
        spot = spot_at_start.get(oracle_id)
        if spot is None:
            continue
        up_strike = spot * (1 + 0.02)
        down_strike = spot * (1 - 0.02)
        p_up = max(bs_binary_price(spot, up_strike, ttm_years, hedge_vol, True), 0.001)
        p_down = max(bs_binary_price(spot, down_strike, ttm_years, hedge_vol, False), 0.001)
        n_up = min(wing_budget / p_up, wing_budget * max_leverage)
        n_down = min(wing_budget / p_down, wing_budget * max_leverage)
        hedge_cost = budget_per_expiry

        if oracle_id in affected_idx:
            # Synthetic crash: settlement is spot × (1 + crash_pct)
            settlement = spot * (1 + crash_pct)
            # Crash means most DOWN bets win → pool pays out heavily
            stressed_pool_pnl = -row["total_cost_usd"] * 3 * scale
        else:
            settlement = settled_lookup.loc[oracle_id, "settlement_usd"]
            stressed_pool_pnl = row["pool_pnl_usd"] * scale

        hedge_payout = 0.0
        if settlement > up_strike:
            hedge_payout += n_up
        if settlement < down_strike:
            hedge_payout += n_down

        nav += stressed_pool_pnl - hedge_cost + hedge_payout
        nav_curve.append(nav)
        times.append(row["expiry_ts"])

    nav_series = pd.Series(nav_curve)
    rolling_max = nav_series.cummax()
    dd = (nav_series / rolling_max - 1).min()
    return {
        "max_dd_pct": dd * 100,
        "final_nav": nav_series.iloc[-1],
        "nav_curve": nav_series,
        "times": times,
    }


print("\n--- Stress test: 10% of expiries see BTC -5% crash ---")
no_hedge_stress = stress_test_crash(annual_hedge_pct=0.00)
hedged_stress = stress_test_crash(annual_hedge_pct=0.05)
print(f"  Without hedge:  DD {no_hedge_stress['max_dd_pct']:.2f}%, "
      f"final NAV ${no_hedge_stress['final_nav']:,.0f}")
print(f"  With 5% hedge:  DD {hedged_stress['max_dd_pct']:.2f}%, "
      f"final NAV ${hedged_stress['final_nav']:,.0f}")

fig, ax = plt.subplots(figsize=(11, 5))
ax.plot(no_hedge_stress["times"], no_hedge_stress["nav_curve"],
        label=f"Naked PLP (DD {no_hedge_stress['max_dd_pct']:.1f}%)", lw=1.4, color="firebrick")
ax.plot(hedged_stress["times"], hedged_stress["nav_curve"],
        label=f"Hedged 5%/yr (DD {hedged_stress['max_dd_pct']:.1f}%)", lw=1.4, color="darkgreen")
ax.set_xlabel("Date")
ax.set_ylabel("Vault NAV (USD)")
ax.set_title("Stress test: BTC -5% on 10% of expiries — hedge value")
ax.legend()
ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(DATA_DIR.parent / "out_stress_test.png", dpi=110)
print("Saved stress-test chart to backtest/out_stress_test.png")


# %% Section 6.6 — STRESS COMPARISON ACROSS STRATEGIES
# Run the stress scenario (10% expiries see -5%) against all 4 strategies so we
# can see if dynamic actually beats fixed in tail conditions.
def stress_dynamic_strategy(scale=50, crash_pct=-0.05, affected_pct=0.10,
                            hedge_vol=0.80, max_leverage=20.0):
    """Stress test with dynamic hedge — utilizes utilization signal per expiry."""
    rng = np.random.default_rng(42)
    n_affected = int(len(settled) * affected_pct)
    affected_idx = set(rng.choice(settled.index, size=n_affected, replace=False))
    expiries_per_year = 365 * 48
    ttm_years = 30 / (365 * 24 * 60)
    nav = 1_000_000.0
    nav_curve = [nav]

    for i, (oracle_id, row) in enumerate(settled.iterrows()):
        spot = spot_at_start.get(oracle_id)
        if spot is None:
            continue
        # Stressed expiries assume HIGH utilization (whale flow caused crash)
        util = 0.55 if oracle_id in affected_idx else synth_utils[min(i, len(synth_utils)-1)]
        annual_pct = dynamic_hedge_pct(util)
        budget = (annual_pct * 1_000_000) / expiries_per_year
        wing = budget / 2

        up_strike = spot * 1.02
        down_strike = spot * 0.98
        p_up = max(bs_binary_price(spot, up_strike, ttm_years, hedge_vol, True), 0.001)
        p_down = max(bs_binary_price(spot, down_strike, ttm_years, hedge_vol, False), 0.001)
        n_up = min(wing / p_up, wing * max_leverage)
        n_down = min(wing / p_down, wing * max_leverage)

        if oracle_id in affected_idx:
            settlement = spot * (1 + crash_pct)
            pool_pnl = -row["total_cost_usd"] * 3 * scale
        else:
            settlement = (settled_lookup.loc[oracle_id, "settlement_usd"]
                          if oracle_id in settled_lookup.index else spot)
            pool_pnl = row["pool_pnl_usd"] * scale

        payout = (n_up if settlement > up_strike else 0.0) \
               + (n_down if settlement < down_strike else 0.0)
        nav += pool_pnl - budget + payout
        nav_curve.append(nav)

    s = pd.Series(nav_curve)
    dd = (s / s.cummax() - 1).min()
    return {"max_dd_pct": dd * 100, "final_nav": s.iloc[-1]}


print("\n=== Strategy stress comparison (10% expiries see BTC -5%, scale=50×) ===")
stress_compare = []
for name, kwargs in [
    ("naked",    dict(annual_hedge_pct=0.00)),
    ("fixed 2%", dict(annual_hedge_pct=0.02)),
    ("fixed 5%", dict(annual_hedge_pct=0.05)),
    ("fixed 10%", dict(annual_hedge_pct=0.10)),
]:
    r = stress_test_crash(scale=50, **kwargs)
    stress_compare.append({"strategy": name, "max_dd_pct": r["max_dd_pct"],
                           "final_nav": r["final_nav"]})
dyn = stress_dynamic_strategy(scale=50)
stress_compare.append({"strategy": "dynamic", "max_dd_pct": dyn["max_dd_pct"],
                       "final_nav": dyn["final_nav"]})
print(pd.DataFrame(stress_compare).to_string(index=False, float_format=lambda x: f"{x:,.2f}"))


# %% Section 7 — Decision summary
print("\n" + "=" * 60)
print(" Phase A FINAL SUMMARY")
print("=" * 60)
print(f"\nSettled-with-bets oracles:   {len(settled)}")
print(f"Period covered:               {(settled['expiry_ts'].iloc[-1] - settled['expiry_ts'].iloc[0]).days} days")
print(f"Total premium collected:      ${settled['total_cost_usd'].sum():,.2f}")
print(f"Total payouts owed:           ${settled['total_payout_usd'].sum():,.2f}")
print(f"Net pool PnL:                 ${settled['pool_pnl_usd'].sum():,.2f}")
print(f"Gross house edge:             {100 * settled['pool_pnl_usd'].sum() / settled['total_cost_usd'].sum():.2f}%")
print()
print("Naked PLP scaling:")
for _, row in sim_df.iterrows():
    print(f"  Scale {row['scale']:>3.0f}×:   APY {row['apy_pct']:>7.2f}%   DD {row['max_dd_pct']:>6.2f}%")
print()
print("Hedged vault (2% OTM wings, annual budget):")
for _, row in grid_df.iterrows():
    print(f"  Scale {row['scale']:>3.0f}×, annual hedge {row['annual_hedge_pct']:>4.0%}: "
          f"APY {row['apy_pct']:>7.2f}%   DD {row['max_dd_pct']:>6.2f}%   "
          f"hedge_drag ${row['net_hedge_drag']:>10,.0f}")
print()
print(f"Stress test (10% of expiries see BTC -5%):")
print(f"  Naked:   DD {no_hedge_stress['max_dd_pct']:>6.2f}%")
print(f"  Hedged:  DD {hedged_stress['max_dd_pct']:>6.2f}%")
print()
print("VERDICT:")
# Find best APY config where DD survives the target threshold
candidates = grid_df[(grid_df["scale"] >= 10) & (grid_df["max_dd_pct"] >= -7) & (grid_df["apy_pct"] >= 14)]
if not candidates.empty:
    best = candidates.sort_values("apy_pct", ascending=False).iloc[0]
    print(f"  ✓ Build vault: at {best['scale']:.0f}× scale with "
          f"{best['annual_hedge_pct']:.0%}/yr hedge → "
          f"{best['apy_pct']:.1f}% APY, {best['max_dd_pct']:.2f}% DD")
else:
    print("  ⚠ No grid combo hits 14% APY at ≤7% DD. Tune hedge sizing or pivot product.")
