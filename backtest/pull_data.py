"""
Pull historical Predict data from the DeepBook predict-server indexer.

The indexer uses single-shot queries with a `limit` knob (no cursor pagination).
We pass a large limit so we get everything in one request. Per-oracle endpoints
additionally accept start_time / end_time (ms) for windowed queries.

Outputs (saved to backtest/data/ as JSONL):
  - oracles.jsonl              all oracle metadata
  - positions_minted.jsonl     every binary mint event
  - positions_redeemed.jsonl   every binary redeem event
  - ranges_minted.jsonl        range mint events
  - ranges_redeemed.jsonl      range redeem events
  - lp_supplies.jsonl          LP supply events
  - lp_withdrawals.jsonl       LP withdrawal events
  - vault_summary.json         current vault snapshot
  - vault_performance.json     share-price time series
  - oracle_history/
      prices_{oid}.jsonl       spot price history per oracle (windowed)
      svi_{oid}.jsonl          SVI surface history per oracle

Usage:
  python pull_data.py                  # full pull (slow, all oracles)
  python pull_data.py --days 7         # restrict per-oracle history to last 7d
  python pull_data.py --skip-per-oracle  # event streams only (~3s)
  python pull_data.py --max-oracles 50 # cap per-oracle work for dev
"""

import argparse
import json
import sys
import time
from pathlib import Path
import urllib.error
import urllib.request

BASE = "https://predict-server.testnet.mystenlabs.com"
PREDICT_ID = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a"
DATA_DIR = Path(__file__).parent / "data"

# Indexer has no cursor pagination. Pass a big limit to get everything.
BIG_LIMIT = 100_000


def http_get(url: str, retries: int = 3) -> bytes:
    """GET with light retry — testnet indexer can hiccup."""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            time.sleep(1 + attempt)
    raise RuntimeError("unreachable")


def fetch_json(path: str, **params) -> object:
    qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    url = f"{BASE}{path}" + (f"?{qs}" if qs else "")
    return json.loads(http_get(url))


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(obj, f, indent=2)


def pull_event_stream(name: str, path: str) -> None:
    print(f"  {name}...", end=" ", flush=True)
    records = fetch_json(path, limit=BIG_LIMIT)
    if not isinstance(records, list):
        raise RuntimeError(f"{path} returned non-list: {type(records).__name__}")
    write_jsonl(DATA_DIR / f"{name}.jsonl", records)
    print(f"{len(records)} records")


def pull_oracles() -> list[dict]:
    print("oracles...", end=" ", flush=True)
    oracles = fetch_json(f"/predicts/{PREDICT_ID}/oracles")
    if not isinstance(oracles, list):
        raise RuntimeError("oracles endpoint did not return a list")
    write_jsonl(DATA_DIR / "oracles.jsonl", oracles)
    print(f"{len(oracles)} records")
    return oracles


def pull_vault_snapshots() -> None:
    print("vault summary + performance...", end=" ", flush=True)
    write_json(DATA_DIR / "vault_summary.json",
               fetch_json(f"/predicts/{PREDICT_ID}/vault/summary"))
    perf = fetch_json(f"/predicts/{PREDICT_ID}/vault/performance")
    write_json(DATA_DIR / "vault_performance.json", perf)
    pts = len(perf.get("points", [])) if isinstance(perf, dict) else 0
    print(f"summary OK, {pts} performance points")


def pull_per_oracle_history(
    oracle_ids: list[str],
    start_time_ms: int | None,
    end_time_ms: int | None,
) -> None:
    """
    For each oracle, pull full spot-price history (windowed if provided)
    and SVI history. These feed the backtest pricing model.
    """
    history_dir = DATA_DIR / "oracle_history"
    history_dir.mkdir(parents=True, exist_ok=True)
    print(f"per-oracle history ({len(oracle_ids)} oracles)...")
    for i, oid in enumerate(oracle_ids, 1):
        try:
            prices = fetch_json(
                f"/oracles/{oid}/prices",
                limit=BIG_LIMIT,
                start_time=start_time_ms,
                end_time=end_time_ms,
            )
            write_jsonl(history_dir / f"prices_{oid}.jsonl", prices)
            svi = fetch_json(f"/oracles/{oid}/svi", limit=BIG_LIMIT)
            write_jsonl(history_dir / f"svi_{oid}.jsonl", svi)
            if i % 25 == 0 or i == len(oracle_ids):
                print(f"  [{i}/{len(oracle_ids)}] last={oid[:10]}... "
                      f"prices={len(prices)} svi={len(svi)}")
        except Exception as e:
            print(f"  WARN oracle {oid[:10]}... failed: {e}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="Restrict per-oracle history to the last N days. Default: all.",
    )
    parser.add_argument(
        "--skip-per-oracle",
        action="store_true",
        help="Skip per-oracle price/SVI history (very fast).",
    )
    parser.add_argument(
        "--max-oracles",
        type=int,
        default=None,
        help="Cap on per-oracle history fetches (for development).",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Pulling from {BASE}")
    print(f"Saving to {DATA_DIR}\n")

    print("== event streams ==")
    pull_event_stream("positions_minted", "/positions/minted")
    pull_event_stream("positions_redeemed", "/positions/redeemed")
    pull_event_stream("ranges_minted", "/ranges/minted")
    pull_event_stream("ranges_redeemed", "/ranges/redeemed")
    pull_event_stream("lp_supplies", "/lp/supplies")
    pull_event_stream("lp_withdrawals", "/lp/withdrawals")

    print("\n== vault snapshots ==")
    pull_vault_snapshots()

    print("\n== oracles ==")
    oracles = pull_oracles()

    if args.skip_per_oracle:
        print("\nSkipping per-oracle history (--skip-per-oracle)")
        return

    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - args.days * 86_400_000 if args.days else None
    # Pick oracles that are active OR whose expiry falls within the window.
    candidates = [
        o for o in oracles
        if cutoff_ms is None
        or o.get("status") == "active"
        or (o.get("expiry") or 0) >= cutoff_ms
    ]
    candidate_ids = [o["oracle_id"] for o in candidates]
    if args.max_oracles:
        candidate_ids = candidate_ids[: args.max_oracles]

    print(f"\n== per-oracle history ==")
    window_desc = f"last {args.days}d" if args.days else "all history"
    print(f"Candidates: {len(candidate_ids)} oracles ({window_desc})")
    pull_per_oracle_history(candidate_ids, cutoff_ms, None)

    print("\n✓ Done. Data lives in", DATA_DIR)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)
