"""
Filter and downsample the raw indexer pull into a backtest-ready dataset.

Why this exists: the raw pull is ~21 GB because the indexer returns every
sub-second spot tick for every oracle. Our backtest only needs:
  - Oracles that actually had bets placed on them (~70 of 3500)
  - Full SVI history for those (small files)
  - Spot prices downsampled to 1 record per minute (60x smaller, still rich)

Inputs (from pull_data.py):
  data/oracles.jsonl
  data/positions_minted.jsonl
  data/ranges_minted.jsonl
  data/oracle_history/prices_{oid}.jsonl
  data/oracle_history/svi_{oid}.jsonl

Outputs:
  data/processed/oracles_with_bets.jsonl  the relevant oracle subset
  data/processed/prices/{oid}.jsonl       1-min downsampled spot history
  data/processed/svi/{oid}.jsonl          full SVI history (unchanged, small)
  data/processed/summary.json             before/after stats

Run safely — does not delete or modify the raw oracle_history/ folder.
You can `rm -rf data/oracle_history/` manually after verifying processed/ works.
"""

import json
from pathlib import Path
from typing import Iterable

DATA_DIR = Path(__file__).parent / "data"
RAW_HISTORY = DATA_DIR / "oracle_history"
OUT_DIR = DATA_DIR / "processed"

# Downsample resolution: one spot record per N milliseconds.
# 60_000 ms = 1 minute. For sub-hour expiries that gives ~30 ticks per expiry.
DOWNSAMPLE_MS = 60_000


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open()]


def write_jsonl(path: Path, records: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
            n += 1
    return n


def downsample_prices(records: list[dict], bucket_ms: int) -> list[dict]:
    """
    Keep at most one record per `bucket_ms` window of time.

    Records arrive newest-first from the indexer; sort by timestamp ASC so the
    first record we pick in each bucket is the bucket's opening price.
    """
    if not records:
        return []
    sorted_recs = sorted(records, key=lambda r: r["checkpoint_timestamp_ms"])
    kept: list[dict] = []
    last_bucket = -1
    for r in sorted_recs:
        bucket = r["checkpoint_timestamp_ms"] // bucket_ms
        if bucket != last_bucket:
            kept.append(r)
            last_bucket = bucket
    return kept


def main() -> None:
    print(f"Reading from {DATA_DIR}")
    print(f"Writing to   {OUT_DIR}\n")

    oracles = load_jsonl(DATA_DIR / "oracles.jsonl")
    mints = load_jsonl(DATA_DIR / "positions_minted.jsonl")
    range_mints = load_jsonl(DATA_DIR / "ranges_minted.jsonl")

    # Oracles with at least one bet (binary or range)
    bet_oracle_ids = (
        {m["oracle_id"] for m in mints}
        | {m["oracle_id"] for m in range_mints}
    )
    useful = [o for o in oracles if o["oracle_id"] in bet_oracle_ids]

    # Sort newest-first so the most recent expiries are easy to find
    useful.sort(key=lambda o: o.get("expiry") or 0, reverse=True)

    print(f"Total oracles in raw pull:        {len(oracles):,}")
    print(f"Oracles with ≥1 bet (useful):     {len(useful):,}")
    print(f"Dead-data oracles dropped:        {len(oracles) - len(useful):,}\n")

    write_jsonl(OUT_DIR / "oracles_with_bets.jsonl", useful)

    # Filter + downsample per-oracle history
    skipped = 0
    raw_price_records = 0
    kept_price_records = 0
    raw_svi_records = 0
    kept_svi_records = 0
    raw_bytes = 0
    kept_bytes = 0

    for i, o in enumerate(useful, 1):
        oid = o["oracle_id"]
        price_in = RAW_HISTORY / f"prices_{oid}.jsonl"
        svi_in = RAW_HISTORY / f"svi_{oid}.jsonl"
        if not price_in.exists() or not svi_in.exists():
            skipped += 1
            continue

        raw_bytes += price_in.stat().st_size + svi_in.stat().st_size

        prices = load_jsonl(price_in)
        svis = load_jsonl(svi_in)

        downsampled_prices = downsample_prices(prices, DOWNSAMPLE_MS)
        # SVI is updated much less frequently, keep all of it
        kept_svi = sorted(svis, key=lambda r: r["checkpoint_timestamp_ms"])

        n_p = write_jsonl(OUT_DIR / "prices" / f"{oid}.jsonl", downsampled_prices)
        n_s = write_jsonl(OUT_DIR / "svi" / f"{oid}.jsonl", kept_svi)

        kept_bytes += (
            (OUT_DIR / "prices" / f"{oid}.jsonl").stat().st_size
            + (OUT_DIR / "svi" / f"{oid}.jsonl").stat().st_size
        )
        raw_price_records += len(prices)
        kept_price_records += n_p
        raw_svi_records += len(svis)
        kept_svi_records += n_s

        if i % 10 == 0 or i == len(useful):
            print(f"  [{i}/{len(useful)}] {oid[:10]}...  "
                  f"prices {len(prices):,} → {n_p:,}   svi {len(svis):,} → {n_s:,}")

    print()
    print(f"Skipped (missing raw files):      {skipped}")
    print(f"Spot records: {raw_price_records:,} → {kept_price_records:,}  "
          f"({100 * kept_price_records / max(raw_price_records, 1):.1f}% kept)")
    print(f"SVI records:  {raw_svi_records:,} → {kept_svi_records:,}  "
          f"({100 * kept_svi_records / max(raw_svi_records, 1):.1f}% kept)")
    print(f"Disk:         {raw_bytes / 1024 / 1024:,.0f} MB → "
          f"{kept_bytes / 1024 / 1024:,.0f} MB  "
          f"({100 * kept_bytes / max(raw_bytes, 1):.2f}% retained)")

    summary = {
        "total_oracles": len(oracles),
        "useful_oracles": len(useful),
        "skipped_oracles": skipped,
        "raw_price_records": raw_price_records,
        "kept_price_records": kept_price_records,
        "raw_svi_records": raw_svi_records,
        "kept_svi_records": kept_svi_records,
        "raw_bytes": raw_bytes,
        "kept_bytes": kept_bytes,
        "downsample_ms": DOWNSAMPLE_MS,
    }
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"\n✓ Done. Filtered dataset lives in {OUT_DIR}")
    print(f"  After verifying, you can free 21 GB with: rm -rf {RAW_HISTORY}")


if __name__ == "__main__":
    main()
