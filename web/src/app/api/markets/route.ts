import { NextResponse } from 'next/server';
import {
  PREDICT_INDEXER_URL,
  getOracleState,
  listOracles,
  type IndexerOracleState,
} from '@hunchbook/shared';
import { decodeScaled, decodeSvi } from '@/lib/svi';
import type { LiveMarket } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5_000;
let cache: { data: LiveMarket[]; at: number } | null = null;

interface TickEvent {
  spot: number;
  checkpoint_timestamp_ms: number;
}

async function fetchTicks(oracleId: string): Promise<TickEvent[]> {
  const res = await fetch(`${PREDICT_INDEXER_URL}/oracles/${oracleId}/prices?limit=200`);
  if (!res.ok) return [];
  const ticks = (await res.json()) as TickEvent[];
  return ticks.reverse(); // newest-first → oldest-first
}

function toLiveMarket(state: IndexerOracleState, ticks: TickEvent[]): LiveMarket | null {
  const { oracle, latest_price, latest_svi } = state;
  if (!latest_price) return null;
  const sparkline = ticks.map((t) => decodeScaled(t.spot));
  const sparkTimes = ticks.map((t) => t.checkpoint_timestamp_ms);
  const first = sparkline[0];
  const last = sparkline[sparkline.length - 1];
  return {
    oracleId: oracle.oracle_id,
    pair: `${oracle.underlying_asset}/USD`,
    spot: decodeScaled(latest_price.spot),
    forward: decodeScaled(latest_price.forward),
    expiry: oracle.expiry,
    minStrike: decodeScaled(oracle.min_strike),
    tickSize: decodeScaled(oracle.tick_size),
    svi: latest_svi
      ? decodeSvi(latest_svi as unknown as Parameters<typeof decodeSvi>[0])
      : null,
    sparkline,
    sparkTimes,
    sessionChangePct: first ? ((last - first) / first) * 100 : 0,
  };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }
  try {
    const oracles = await listOracles();
    const active = oracles
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.expiry - b.expiry);
    const markets = (
      await Promise.all(
        active.map(async (o) => {
          const [state, ticks] = await Promise.all([
            getOracleState(o.oracle_id),
            fetchTicks(o.oracle_id),
          ]);
          return toLiveMarket(state, ticks);
        }),
      )
    ).filter((m): m is LiveMarket => m !== null);
    // Mid-rollover (or on indexer lag) the active list can be transiently
    // empty. Serving — and worse, caching — that empty snapshot blanks every
    // panel on the trade page for seconds. Serve the last good list instead
    // and keep it cached until real markets come back.
    if (markets.length === 0 && cache && cache.data.length > 0) {
      cache = { data: cache.data, at: Date.now() };
      return NextResponse.json(cache.data);
    }
    cache = { data: markets, at: Date.now() };
    return NextResponse.json(markets);
  } catch (err) {
    if (cache) return NextResponse.json(cache.data); // stale-on-error
    return NextResponse.json(
      { error: `Predict indexer unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
