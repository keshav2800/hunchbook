/*
 * Incremental indexer for the leaderboard. Walks every recent router::place_bet
 * and router::cashout newest-first, stopping at the digest persisted from the
 * previous run, and writes one row per tx into Postgres. The leaderboard route
 * aggregates over these tables — the chain is no longer scanned at read time,
 * so users keep their stats indefinitely even when other traders push 400+
 * newer txs onto the queue.
 *
 * Idempotent: rows use the tx digest as the primary key, so re-running is safe.
 */
import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { ROUTER_PACKAGE_ID, SUI_FULLNODE_URL } from '@hunchbook/shared';
import { parseTxForOwner, type BetTxRecord, type CashoutTxRecord } from '@/lib/server/parse-bets';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYNC_ID = 'leaderboard';
// Hard ceiling so a single backfill invocation can't blow past the serverless
// function timeout — subsequent runs continue from where this one stopped.
const MAX_PAGES_PER_FN = 50;

interface ScannedBet extends BetTxRecord {
  sender: string;
}
interface ScannedCashout extends CashoutTxRecord {
  sender: string;
}

async function scanSince(
  client: SuiClient,
  fn: 'place_bet' | 'cashout',
  stopAtDigest: string | null,
): Promise<{ bets: ScannedBet[]; cashouts: ScannedCashout[]; newestDigest: string | null; reachedEnd: boolean }> {
  const bets: ScannedBet[] = [];
  const cashouts: ScannedCashout[] = [];
  let newestDigest: string | null = null;
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  let reachedKnown = false;

  while (pages < MAX_PAGES_PER_FN) {
    const page = await client.queryTransactionBlocks({
      filter: { MoveFunction: { package: ROUTER_PACKAGE_ID, module: 'router', function: fn } },
      options: { showInput: true, showBalanceChanges: true, showEffects: true, showEvents: true },
      cursor: cursor ?? undefined,
      limit: 50,
      order: 'descending',
    });
    for (const tx of page.data) {
      if (newestDigest === null) newestDigest = tx.digest;
      if (stopAtDigest && tx.digest === stopAtDigest) {
        reachedKnown = true;
        break;
      }
      const sender = (tx.transaction?.data as { sender?: string } | undefined)?.sender;
      if (!sender) continue;
      const { bet, cashout } = parseTxForOwner(tx, sender);
      if (bet) bets.push({ ...bet, sender });
      if (cashout) cashouts.push({ ...cashout, sender });
    }
    pages += 1;
    if (reachedKnown) break;
    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }
  return { bets, cashouts, newestDigest, reachedEnd: reachedKnown || pages < MAX_PAGES_PER_FN };
}

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → open (dev / first deploy). Set it in prod.
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

// GET allowed so the leaderboard route can self-trigger a sync inline without
// re-implementing auth — same handler, no secret required for internal callers
// (Vercel cron uses POST + Authorization, browsers can't reach it without one).
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

async function run() {
  try {
    const cursors = await prisma.leaderboardSync.findUnique({ where: { id: SYNC_ID } });
    const client = new SuiClient({ url: SUI_FULLNODE_URL });
    const [betScan, cashoutScan] = await Promise.all([
      scanSince(client, 'place_bet', cursors?.lastBetDigest ?? null),
      scanSince(client, 'cashout', cursors?.lastCashoutDigest ?? null),
    ]);

    if (betScan.bets.length > 0) {
      await prisma.betTx.createMany({
        data: betScan.bets.map((b) => ({
          digest: b.digest,
          sender: b.sender,
          oracleId: b.oracleId,
          expiry: BigInt(b.expiry),
          strikeUsd: b.strikeUsd,
          direction: b.direction,
          stakeUsd: b.stakeUsd,
          units: b.units,
          timestampMs: BigInt(b.timestampMs),
        })),
        skipDuplicates: true,
      });
    }
    if (cashoutScan.cashouts.length > 0) {
      await prisma.cashoutTx.createMany({
        data: cashoutScan.cashouts.map((c) => ({
          digest: c.digest,
          sender: c.sender,
          oracleId: c.oracleId,
          expiry: BigInt(c.expiry),
          strikeUsd: c.strikeUsd,
          direction: c.direction,
          receivedUsd: c.receivedUsd,
          timestampMs: BigInt(c.timestampMs),
        })),
        skipDuplicates: true,
      });
    }

    // Only advance the cursor when we actually caught up to the previous head
    // (or finished a full backfill). If we stopped because we hit MAX_PAGES_PER_FN
    // mid-backfill, leave the cursor alone so the next run resumes correctly.
    const advanceBet = betScan.reachedEnd && betScan.newestDigest;
    const advanceCashout = cashoutScan.reachedEnd && cashoutScan.newestDigest;
    await prisma.leaderboardSync.upsert({
      where: { id: SYNC_ID },
      create: {
        id: SYNC_ID,
        lastBetDigest: advanceBet ? betScan.newestDigest : null,
        lastCashoutDigest: advanceCashout ? cashoutScan.newestDigest : null,
      },
      update: {
        lastBetDigest: advanceBet ? betScan.newestDigest : cursors?.lastBetDigest,
        lastCashoutDigest: advanceCashout ? cashoutScan.newestDigest : cursors?.lastCashoutDigest,
        lastRunAt: new Date(),
      },
    });

    return NextResponse.json({
      newBets: betScan.bets.length,
      newCashouts: cashoutScan.cashouts.length,
      backfilling: !(betScan.reachedEnd && cashoutScan.reachedEnd),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
