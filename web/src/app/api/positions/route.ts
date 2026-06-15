import { NextResponse } from 'next/server';
import { SuiClient } from '@mysten/sui/client';
import { SUI_FULLNODE_URL, listOracles } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import { parseBetsFromHistory } from '@/lib/server/parse-bets';
import type { BetPosition } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DUSDC_SCALE = 1e6;
const MAX_POSITIONS = 200;

interface MarketKeyFields {
  oracle_id: string;
  expiry: string;
  strike: string;
  direction: number;
}

function stakeKey(oracleId: string, strikeUsd: number, direction: string): string {
  return `${oracleId}|${Math.round(strikeUsd)}|${direction}`;
}

/** Aggregate chain-derived stakes per position key (bets on the same key merge). */
async function fetchStakesByKey(client: SuiClient, owner: string): Promise<Map<string, number>> {
  const stakes = new Map<string, number>();
  for (const r of (await parseBetsFromHistory(client, owner)).bets) {
    const key = stakeKey(r.oracleId, r.strikeUsd, r.direction);
    stakes.set(key, (stakes.get(key) ?? 0) + r.stakeUsd);
  }
  return stakes;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const manager = url.searchParams.get('manager');
  const owner = url.searchParams.get('owner');
  if (!manager?.startsWith('0x')) {
    return NextResponse.json({ error: 'manager query param required' }, { status: 400 });
  }
  try {
    const client = new SuiClient({ url: SUI_FULLNODE_URL });

    // 1. Manager object → positions Table object id
    const managerObj = await client.getObject({ id: manager, options: { showContent: true } });
    const content = managerObj.data?.content;
    if (content?.dataType !== 'moveObject') {
      return NextResponse.json({ error: 'manager object not found' }, { status: 404 });
    }
    const fields = content.fields as {
      positions: { fields: { id: { id: string } } };
      balance_manager: { fields: { balances: { fields: { id: { id: string }; size: string } } } };
    };
    const tableId = fields.positions.fields.id.id;

    // Manager's internal dUSDC balance (auto-settled winnings land here)
    let managerBalanceUsd = 0;
    const balancesBag = fields.balance_manager.fields.balances.fields;
    if (Number(balancesBag.size) > 0) {
      const bagFields = await client.getDynamicFields({ parentId: balancesBag.id.id });
      const dusdcField = bagFields.data.find((f) => f.name.type.includes('::dusdc::DUSDC'));
      if (dusdcField) {
        const obj = await client.getObject({ id: dusdcField.objectId, options: { showContent: true } });
        const c = obj.data?.content;
        if (c?.dataType === 'moveObject') {
          managerBalanceUsd = Number((c.fields as { value: string }).value) / DUSDC_SCALE;
        }
      }
    }

    // 2. All dynamic fields of the positions table (paginated)
    const fieldIds: string[] = [];
    let cursor: string | null | undefined = undefined;
    do {
      const page = await client.getDynamicFields({ parentId: tableId, cursor });
      fieldIds.push(...page.data.map((f) => f.objectId));
      cursor = page.hasNextPage ? page.nextCursor : null;
    } while (cursor && fieldIds.length < MAX_POSITIONS);

    if (fieldIds.length === 0) {
      return NextResponse.json({ positions: [], managerBalanceUsd });
    }

    // 3. Field objects → MarketKey + quantity
    const fieldObjs = await client.multiGetObjects({
      ids: fieldIds,
      options: { showContent: true },
    });

    // 4. Join oracle settlement state + chain-derived stakes (in parallel)
    const [oracleList, stakes] = await Promise.all([
      listOracles(),
      owner?.startsWith('0x') ? fetchStakesByKey(client, owner) : Promise.resolve(new Map<string, number>()),
    ]);
    const oracles = new Map(oracleList.map((o) => [o.oracle_id, o]));

    const positions: BetPosition[] = [];
    for (const obj of fieldObjs) {
      const c = obj.data?.content;
      if (c?.dataType !== 'moveObject') continue;
      const f = c.fields as unknown as {
        name: { fields: MarketKeyFields };
        value: string;
      };
      const key = f.name.fields;
      if (Number(f.value) === 0) continue; // redeemed/settled stub — already paid out
      const oracle = oracles.get(key.oracle_id);
      const settled = oracle?.status === 'settled' && oracle.settlement_price !== null;
      const strikeUsd = decodeScaled(Number(key.strike));
      const direction = key.direction === 0 ? 'UP' : 'DOWN';
      const settlementUsd = settled ? decodeScaled(Number(oracle!.settlement_price)) : null;
      positions.push({
        oracleId: key.oracle_id,
        expiry: Number(key.expiry),
        strikeUsd,
        direction,
        units: Number(f.value) / DUSDC_SCALE,
        stakeUsd: stakes.get(stakeKey(key.oracle_id, strikeUsd, direction)) ?? null,
        status: settled ? 'settled' : 'active',
        won: settled
          ? direction === 'UP'
            ? settlementUsd! > strikeUsd
            : settlementUsd! < strikeUsd
          : null,
        settlementUsd,
      });
    }

    positions.sort((a, b) =>
      a.status === b.status ? a.expiry - b.expiry : a.status === 'active' ? -1 : 1,
    );
    return NextResponse.json({ positions, managerBalanceUsd });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
