import { NextResponse } from 'next/server';
import { PREDICT_INDEXER_URL } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';

export const dynamic = 'force-dynamic';

interface TickEvent {
  spot: number;
  checkpoint_timestamp_ms: number;
}

// Downsample target — a few hundred points renders a smooth line cheaply.
const TARGET_POINTS = 400;
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; data: { spots: number[]; times: number[] } }>();

/**
 * Price history for one oracle over a chosen window (minutes), so the chart's
 * x-axis can zoom out past the ~3-min `limit=200` sparkline. Ticks arrive at
 * ~1/sec, so we over-fetch for the window, trim to it, and downsample.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const oracleId = params.get('oracleId');
  const minutes = Math.min(Math.max(Number(params.get('minutes')) || 15, 1), 240);
  if (!oracleId?.startsWith('0x')) {
    return NextResponse.json({ error: 'oracleId query param required' }, { status: 400 });
  }

  const key = `${oracleId}:${minutes}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.data);

  try {
    const limit = Math.min(Math.ceil(minutes * 70), 6000); // ~58 ticks/min + headroom
    const res = await fetch(`${PREDICT_INDEXER_URL}/oracles/${oracleId}/prices?limit=${limit}`);
    if (!res.ok) throw new Error(`indexer ${res.status}`);
    const ticks = ((await res.json()) as TickEvent[]).reverse(); // newest-first → oldest-first

    const cutoff = Date.now() - minutes * 60_000;
    const windowed = ticks.filter((t) => t.checkpoint_timestamp_ms >= cutoff);
    const src = windowed.length > 1 ? windowed : ticks; // fall back to all we have

    const stride = Math.max(1, Math.ceil(src.length / TARGET_POINTS));
    const spots: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < src.length; i += stride) {
      spots.push(decodeScaled(src[i].spot));
      times.push(src[i].checkpoint_timestamp_ms);
    }
    // Always pin the latest tick so the line ends at the live price.
    const last = src[src.length - 1];
    if (last && times[times.length - 1] !== last.checkpoint_timestamp_ms) {
      spots.push(decodeScaled(last.spot));
      times.push(last.checkpoint_timestamp_ms);
    }

    const data = { spots, times };
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    if (hit) return NextResponse.json(hit.data); // stale-on-error
    return NextResponse.json(
      { error: `prices unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
