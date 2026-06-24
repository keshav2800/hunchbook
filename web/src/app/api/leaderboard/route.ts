import { NextResponse } from 'next/server';
import { listOracles } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import { prisma } from '@/lib/server/prisma';
import type { LeaderboardEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

const WEEK_MS = 7 * 86_400_000;
const SYNC_STALE_MS = 90_000; // re-trigger sync if last run was older than this

interface LeaderboardPayload {
  weekly: LeaderboardEntry[];
  allTime: LeaderboardEntry[];
  scannedTxs: number; // total bets in DB — kept for back-compat with the client
  truncated: boolean; // always false now (DB-backed), kept for back-compat
}

const CACHE_TTL_MS = 60_000;
let cached: { at: number; payload: LeaderboardPayload } | null = null;

interface AddrStats {
  address: string;
  totalBets: number;
  wins: number;
  losses: number;
  wageredUsd: number;
  pnlUsd: number;
}

const marketKey = (
  sender: string,
  r: { oracleId: string; expiry: number | bigint; strikeUsd: number; direction: string },
) => `${sender}|${r.oracleId}|${Number(r.expiry)}|${Math.round(r.strikeUsd * 100)}|${r.direction}`;

function rank(stats: AddrStats[]): LeaderboardEntry[] {
  return stats
    .filter((s) => s.totalBets > 0)
    .sort((a, b) => b.wageredUsd - a.wageredUsd)
    .slice(0, 25)
    .map((s, i) => {
      const settled = s.wins + s.losses;
      return {
        rank: i + 1,
        address: s.address,
        winRatePct: settled > 0 ? (s.wins / settled) * 100 : 0,
        wageredUsd: s.wageredUsd,
        pnlUsd: s.pnlUsd,
        totalBets: s.totalBets,
        wins: s.wins,
        losses: s.losses,
      };
    });
}

// Best-effort sync trigger — fires when the indexer hasn't run lately, so dev
// mode and self-hosted deploys without Vercel cron still get fresh data. We
// don't await: stale-while-revalidate is fine because the cache below absorbs
// the first request that races the sync.
async function maybeTriggerSync(req: Request): Promise<void> {
  const row = await prisma.leaderboardSync.findUnique({ where: { id: 'leaderboard' } });
  if (row && Date.now() - row.lastRunAt.getTime() < SYNC_STALE_MS) return;
  const url = new URL('/api/leaderboard/sync', req.url);
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  fetch(url, { headers }).catch(() => {});
}

export async function GET(req: Request) {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    void maybeTriggerSync(req);
    return NextResponse.json(cached.payload, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }
  try {
    await maybeTriggerSync(req);

    const [bets, cashouts, oracleList] = await Promise.all([
      prisma.betTx.findMany(),
      prisma.cashoutTx.findMany(),
      listOracles(),
    ]);
    const oracles = new Map(oracleList.map((o) => [o.oracle_id, o]));

    // Early cash-outs (pre-expiry) remove a bet from the win/loss record. Keep
    // the received amount so P/L can realize (received − stake) on the early exit.
    const earlyCashouts = new Map<string, number>();
    for (const c of cashouts) {
      if (Number(c.timestampMs) < Number(c.expiry)) {
        earlyCashouts.set(marketKey(c.sender, c), c.receivedUsd);
      }
    }

    const build = (sinceMs: number): LeaderboardEntry[] => {
      const byAddr = new Map<string, AddrStats>();
      for (const bet of bets) {
        if (Number(bet.timestampMs) < sinceMs) continue;
        let s = byAddr.get(bet.sender);
        if (!s) {
          s = { address: bet.sender, totalBets: 0, wins: 0, losses: 0, wageredUsd: 0, pnlUsd: 0 };
          byAddr.set(bet.sender, s);
        }
        s.totalBets += 1;
        s.wageredUsd += bet.stakeUsd;
        const key = marketKey(bet.sender, bet);
        const earlyReceived = earlyCashouts.get(key);
        if (earlyReceived !== undefined) {
          s.pnlUsd += earlyReceived - bet.stakeUsd;
          continue;
        }
        const oracle = oracles.get(bet.oracleId);
        if (oracle?.status !== 'settled' || oracle.settlement_price === null) continue; // open → unrealized
        const settlementUsd = decodeScaled(Number(oracle.settlement_price));
        const won =
          bet.direction === 'UP' ? settlementUsd > bet.strikeUsd : settlementUsd < bet.strikeUsd;
        if (won) {
          s.wins += 1;
          s.pnlUsd += bet.units - bet.stakeUsd; // won binary pays `units` × $1
        } else {
          s.losses += 1;
          s.pnlUsd -= bet.stakeUsd;
        }
      }
      return rank([...byAddr.values()]);
    };

    const payload: LeaderboardPayload = {
      weekly: build(Date.now() - WEEK_MS),
      allTime: build(0),
      scannedTxs: bets.length + cashouts.length,
      truncated: false,
    };
    cached = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
