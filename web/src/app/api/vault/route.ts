import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import {
  PF_SHARE_COIN_TYPE,
  SUI_FULLNODE_URL,
  VAULT_OBJECT_ID,
  VAULT_PACKAGE_ID,
} from '@hunchbook/shared';
import type { VaultStats, VaultTransaction } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Q64 = 1n << 64n;
const DUSDC_SCALE = 1e6;
const DAY_MS = 86_400_000;

// Vault-wide stats are identical for everyone — cache the expensive part
// (object read + full event replay) and only personalize the position.
const CACHE_TTL_MS = 15_000;
let cached: { at: number; base: Omit<VaultStats, 'userPositionUsd' | 'userShares'> } | null = null;

interface ReplayState {
  idle: bigint;
  deployed: bigint;
  plp: bigint;
  mark: bigint;
  shares: bigint;
}

const navOf = (s: ReplayState): bigint => s.idle + s.deployed + (s.plp * s.mark) / Q64;
const priceOf = (s: ReplayState): number =>
  s.shares === 0n ? 1 : Number(navOf(s)) / Number(s.shares);

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Replay all vault events in order, returning per-event NAV/price snapshots. */
async function replayHistory(client: SuiClient): Promise<{
  points: { timestampMs: number; nav: number; price: number }[];
  transactions: VaultTransaction[];
}> {
  const state: ReplayState = { idle: 0n, deployed: 0n, plp: 0n, mark: 0n, shares: 0n };
  const points: { timestampMs: number; nav: number; price: number }[] = [];
  const transactions: VaultTransaction[] = [];

  let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined;
  do {
    const page = await client.queryEvents({
      query: { MoveEventModule: { package: VAULT_PACKAGE_ID, module: 'vault' } },
      cursor: cursor ?? undefined,
      limit: 100,
      order: 'ascending',
    });
    for (const ev of page.data) {
      const kind = ev.type.split('::').pop()!;
      const j = ev.parsedJson as Record<string, string>;
      // Only this vault instance's events count (one package can host many vaults).
      if (j.vault_id && j.vault_id !== VAULT_OBJECT_ID) continue;
      const ts = Number(ev.timestampMs ?? 0);
      switch (kind) {
        case 'Deposited':
          state.idle += BigInt(j.quote_in);
          state.shares += BigInt(j.shares_out);
          transactions.push({
            digest: ev.id.txDigest,
            type: 'Deposit',
            amountUsd: Number(j.quote_in) / DUSDC_SCALE,
            lp: j.lp,
            timestampMs: ts,
          });
          break;
        case 'Withdrawn':
          state.idle -= BigInt(j.quote_out);
          state.shares -= BigInt(j.shares_in);
          transactions.push({
            digest: ev.id.txDigest,
            type: 'Withdraw',
            amountUsd: Number(j.quote_out) / DUSDC_SCALE,
            lp: j.lp,
            timestampMs: ts,
          });
          break;
        case 'CapitalDeployed':
          state.idle -= BigInt(j.amount);
          state.deployed += BigInt(j.amount);
          break;
        case 'CapitalReclaimed':
          state.idle += BigInt(j.amount);
          state.deployed -= BigInt(j.amount);
          break;
        case 'PlpSupplied':
          state.idle -= BigInt(j.quote_in);
          state.plp += BigInt(j.plp_received);
          state.mark = BigInt(j.mark_q64);
          break;
        case 'PlpRedeemed':
          state.plp -= BigInt(j.plp_burned);
          state.idle += BigInt(j.quote_received);
          state.mark = BigInt(j.mark_q64);
          break;
        case 'PlpMarked':
          state.mark = BigInt(j.mark_q64);
          break;
        case 'FeesAccrued':
          // accrue_fees splits fees out of idle into escrow — NAV drops here.
          state.idle -= BigInt(j.mgmt_delta) + BigInt(j.perf_delta);
          break;
        default:
          continue; // VaultCreated / pauses / claims — no NAV effect
      }
      points.push({ timestampMs: ts, nav: Number(navOf(state)) / DUSDC_SCALE, price: priceOf(state) });
    }
    cursor = page.hasNextPage
      ? (page.nextCursor as { txDigest: string; eventSeq: string } | null)
      : null;
  } while (cursor);

  // Several events land in one tx (e.g. PlpMarked + PlpSupplied) — keep the
  // final snapshot per timestamp so the chart doesn't show intra-tx states.
  const dedup = new Map<number, { timestampMs: number; nav: number; price: number }>();
  for (const p of points) dedup.set(p.timestampMs, p);
  return { points: [...dedup.values()], transactions: transactions.reverse().slice(0, 20) };
}

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner');
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });

    let base = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.base : null;
    if (!base) {
      const [obj, replay] = await Promise.all([
        client.getObject({ id: VAULT_OBJECT_ID, options: { showContent: true } }),
        replayHistory(client),
      ]);
      const content = obj.data?.content;
      if (content?.dataType !== 'moveObject') throw new Error('vault object not found');
      const f = content.fields as unknown as {
        idle: string;
        plp_balance: string;
        plp_mark_q64: string;
        deployed_principal: string;
        treasury: { fields: { total_supply: { fields: { value: string } } } };
      };
      const live: ReplayState = {
        idle: BigInt(f.idle),
        deployed: BigInt(f.deployed_principal),
        plp: BigInt(f.plp_balance),
        mark: BigInt(f.plp_mark_q64),
        shares: BigInt(f.treasury.fields.total_supply.fields.value),
      };
      const nav = Number(navOf(live)) / DUSDC_SCALE;
      const sharePrice = priceOf(live);
      const now = Date.now();
      const series = [...replay.points, { timestampMs: now, nav, price: sharePrice }];

      let peak = 0;
      const history = series.map((p) => {
        peak = Math.max(peak, p.price);
        return {
          date: dateLabel(p.timestampMs),
          nav: p.nav,
          drawdownPct: peak > 0 ? ((p.price - peak) / peak) * 100 : 0,
        };
      });

      const first = replay.points[0];
      const spanMs = first ? now - first.timestampMs : 0;
      const apyPct =
        first && spanMs >= DAY_MS && first.price > 0
          ? (Math.pow(sharePrice / first.price, (365 * DAY_MS) / spanMs) - 1) * 100
          : null;
      const dayAgo = [...replay.points].reverse().find((p) => now - p.timestampMs >= DAY_MS);
      const sharePriceChangePct =
        dayAgo && dayAgo.price > 0 ? ((sharePrice - dayAgo.price) / dayAgo.price) * 100 : null;

      const idleUsd = Number(live.idle) / DUSDC_SCALE;
      const plpUsd = Number((live.plp * live.mark) / Q64) / DUSDC_SCALE;
      const deployedUsd = Number(live.deployed) / DUSDC_SCALE;
      const gross = idleUsd + plpUsd + deployedUsd;
      const pct = (x: number) => (gross > 0 ? Math.round((x / gross) * 100) : 0);

      base = {
        tvlUsd: nav,
        sharePrice,
        sharePriceChangePct,
        apyPct,
        composition: [
          { label: 'DeepBook PLP', pct: pct(plpUsd) },
          { label: 'USDC Buffer', pct: pct(idleUsd) },
          { label: 'Hedge (manager)', pct: pct(deployedUsd) },
        ],
        history,
        recentTransactions: replay.transactions,
      };
      cached = { at: Date.now(), base };
    }

    let userPositionUsd: number | null = null;
    let userShares: number | null = null;
    if (owner?.startsWith('0x')) {
      const bal = await client.getBalance({ owner, coinType: PF_SHARE_COIN_TYPE });
      userShares = Number(bal.totalBalance) / DUSDC_SCALE;
      userPositionUsd = userShares * base.sharePrice;
    }

    const payload: VaultStats = { ...base, userPositionUsd, userShares };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
