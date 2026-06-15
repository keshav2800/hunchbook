import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { ROUTER_PACKAGE_ID, SUI_FULLNODE_URL, listOracles } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import { parseTxForOwner, type BetTxRecord, type CashoutTxRecord } from '@/lib/server/parse-bets';
import type { LeaderboardEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_TXS_PER_FN = 400; // newest-first scan cap per function
const WEEK_MS = 7 * 86_400_000;

interface LeaderboardPayload {
  weekly: LeaderboardEntry[];
  allTime: LeaderboardEntry[];
  scannedTxs: number;
  truncated: boolean;
}

// Global data, identical for all viewers — cache aggressively.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; payload: LeaderboardPayload } | null = null;

/** Scan every recent call of router::<fn> regardless of sender. */
async function scanRouterTxs(
  client: SuiClient,
  fn: 'place_bet' | 'cashout',
): Promise<{ bets: BetTxRecord[]; cashouts: CashoutTxRecord[]; bySender: Map<string, string[]>; count: number; truncated: boolean }> {
  const bets: BetTxRecord[] = [];
  const cashouts: CashoutTxRecord[] = [];
  const bySender = new Map<string, string[]>();
  let cursor: string | null | undefined = undefined;
  let count = 0;
  do {
    const page = await client.queryTransactionBlocks({
      filter: { MoveFunction: { package: ROUTER_PACKAGE_ID, module: 'router', function: fn } },
      options: { showInput: true, showBalanceChanges: true, showEffects: true },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const tx of page.data) {
      const sender = (tx.transaction?.data as { sender?: string } | undefined)?.sender;
      if (!sender) continue;
      const { bet, cashout } = parseTxForOwner(tx, sender);
      if (bet) {
        bets.push(bet);
        bySender.set(bet.digest, [sender, 'bet']);
      }
      if (cashout) {
        cashouts.push(cashout);
        bySender.set(cashout.digest, [sender, 'cashout']);
      }
    }
    count += page.data.length;
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor && count < MAX_TXS_PER_FN);
  return { bets, cashouts, bySender, count, truncated: !!cursor };
}

interface AddrStats {
  address: string;
  totalBets: number;
  wins: number;
  losses: number;
  wageredUsd: number;
}

const marketKey = (sender: string, r: { oracleId: string; expiry: number; strikeUsd: number; direction: string }) =>
  `${sender}|${r.oracleId}|${r.expiry}|${Math.round(r.strikeUsd * 100)}|${r.direction}`;

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
        totalBets: s.totalBets,
        wins: s.wins,
        losses: s.losses,
      };
    });
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  }
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    const [betScan, cashoutScan, oracleList] = await Promise.all([
      scanRouterTxs(client, 'place_bet'),
      scanRouterTxs(client, 'cashout'),
      listOracles(),
    ]);
    const oracles = new Map(oracleList.map((o) => [o.oracle_id, o]));

    // Early cash-outs (pre-expiry) remove a bet from the win/loss record —
    // same semantics as /api/history, keyed per sender + market.
    const earlyCashouts = new Set<string>();
    for (const c of cashoutScan.cashouts) {
      const sender = cashoutScan.bySender.get(c.digest)?.[0];
      if (sender && c.timestampMs < c.expiry) earlyCashouts.add(marketKey(sender, c));
    }

    const build = (sinceMs: number): LeaderboardEntry[] => {
      const byAddr = new Map<string, AddrStats>();
      for (const bet of betScan.bets) {
        if (bet.timestampMs < sinceMs) continue;
        const sender = betScan.bySender.get(bet.digest)?.[0];
        if (!sender) continue;
        let s = byAddr.get(sender);
        if (!s) {
          s = { address: sender, totalBets: 0, wins: 0, losses: 0, wageredUsd: 0 };
          byAddr.set(sender, s);
        }
        s.totalBets += 1;
        s.wageredUsd += bet.stakeUsd;
        if (earlyCashouts.has(marketKey(sender, bet))) continue; // neither win nor loss
        const oracle = oracles.get(bet.oracleId);
        if (oracle?.status !== 'settled' || oracle.settlement_price === null) continue;
        const settlementUsd = decodeScaled(Number(oracle.settlement_price));
        const won =
          bet.direction === 'UP' ? settlementUsd > bet.strikeUsd : settlementUsd < bet.strikeUsd;
        if (won) s.wins += 1;
        else s.losses += 1;
      }
      return rank([...byAddr.values()]);
    };

    const payload: LeaderboardPayload = {
      weekly: build(Date.now() - WEEK_MS),
      allTime: build(0),
      scannedTxs: betScan.count + cashoutScan.count,
      truncated: betScan.truncated || cashoutScan.truncated,
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
