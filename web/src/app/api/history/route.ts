import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { SUI_FULLNODE_URL, listOracles } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import { parseBetsFromHistory } from '@/lib/server/parse-bets';
import type { BetHistoryEntry, BetStats } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface HistoryPayload {
  bets: BetHistoryEntry[];
  stats: BetStats;
  firstBetMs: number | null;
  truncated: boolean;
}

// History walks ≤200 txs per call — cache per owner for a short TTL.
// Module-level Map is fine for a single Next instance (dev/demo deployment).
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; payload: HistoryPayload }>();

const marketKey = (r: { oracleId: string; expiry: number; strikeUsd: number; direction: string }) =>
  `${r.oracleId}|${r.expiry}|${Math.round(r.strikeUsd * 100)}|${r.direction}`;

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner');
  if (!owner?.startsWith('0x')) {
    return NextResponse.json({ error: 'owner query param required' }, { status: 400 });
  }
  const hit = cache.get(owner);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  }
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    const [{ bets: records, cashouts, truncated }, oracleList] = await Promise.all([
      parseBetsFromHistory(client, owner),
      listOracles(),
    ]);
    const oracles = new Map(oracleList.map((o) => [o.oracle_id, o]));

    // Early cash-outs end a position before settlement; post-expiry cashouts are claims.
    const earlyCashouts = new Map<string, number>();
    const claims = new Map<string, number>();
    for (const c of cashouts) {
      const target = c.timestampMs < c.expiry ? earlyCashouts : claims;
      const k = marketKey(c);
      target.set(k, (target.get(k) ?? 0) + c.receivedUsd);
    }
    const unitsByKey = new Map<string, number>();
    for (const r of records) {
      const k = marketKey(r);
      unitsByKey.set(k, (unitsByKey.get(k) ?? 0) + r.units);
    }

    const bets: BetHistoryEntry[] = records.map((r) => {
      const k = marketKey(r);
      const share = (total: number) => total * (r.units / (unitsByKey.get(k) || 1));
      const early = earlyCashouts.get(k);
      if (early !== undefined) {
        return {
          ...r,
          outcome: 'cashed_out' as const,
          settlementUsd: null,
          payoutUsd: share(early),
        };
      }
      const oracle = oracles.get(r.oracleId);
      const settled = oracle?.status === 'settled' && oracle.settlement_price !== null;
      const settlementUsd = settled ? decodeScaled(Number(oracle!.settlement_price)) : null;
      const won = settled
        ? r.direction === 'UP'
          ? settlementUsd! > r.strikeUsd
          : settlementUsd! < r.strikeUsd
        : null;
      const claimed = claims.get(k);
      const payoutUsd = !settled
        ? null
        : won
          ? claimed !== undefined
            ? share(claimed)
            : r.units
          : 0;
      return {
        ...r,
        outcome: settled ? (won ? ('won' as const) : ('lost' as const)) : ('open' as const),
        settlementUsd,
        payoutUsd,
      };
    });
    bets.sort((a, b) => b.timestampMs - a.timestampMs);

    const stats: BetStats = {
      totalBets: bets.length,
      wins: bets.filter((b) => b.outcome === 'won').length,
      losses: bets.filter((b) => b.outcome === 'lost').length,
      cashedOut: bets.filter((b) => b.outcome === 'cashed_out').length,
      wageredUsd: bets.reduce((acc, b) => acc + b.stakeUsd, 0),
    };
    const firstBetMs = bets.length ? bets[bets.length - 1].timestampMs : null;

    const payload: HistoryPayload = { bets, stats, firstBetMs, truncated };
    cache.set(owner, { at: Date.now(), payload });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
