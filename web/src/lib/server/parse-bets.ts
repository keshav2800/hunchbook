/*
 * Server-side reconstruction of a user's betting history from the chain:
 * every successful place_bet transaction carries the strike/direction/quantity
 * in its inputs and the dUSDC stake in its balance changes. router::cashout
 * txs are parsed too, so early exits and post-expiry claims can be told apart
 * from settlement outcomes.
 */
import type { SuiClient } from '@mysten/sui/client';
import { DUSDC_COIN_TYPE } from '@hunchbook/shared';
import { decodeScaled } from '@/lib/svi';
import type { Direction } from '@/lib/types';

const DUSDC_SCALE = 1e6;
const MAX_HISTORY_TXS = 200;

export interface BetTxRecord {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number; // unix ms
  strikeUsd: number;
  direction: Direction;
  stakeUsd: number;
  units: number; // $1-payout units bought
}

export interface CashoutTxRecord {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number;
  strikeUsd: number;
  direction: Direction;
  receivedUsd: number; // dUSDC that reached the wallet (after the 1% router fee)
}

export interface HistoryTxRecords {
  bets: BetTxRecord[];
  cashouts: CashoutTxRecord[];
  truncated: boolean; // MAX_HISTORY_TXS cap hit with more pages remaining
}

interface MoveCallRef {
  module: string;
  function: string;
  arguments?: unknown[];
}

type TxBlock = {
  digest: string;
  timestampMs?: string | null;
  effects?: { status: { status: string } } | null;
  transaction?: { data: { transaction: unknown } } | null;
  balanceChanges?:
    | { coinType: string; owner: unknown; amount: string }[]
    | null;
  events?: { type: string; parsedJson?: unknown }[] | null;
};

const DEEPBOOK_BALANCE_EVENT_SUFFIX = '::balance_manager::BalanceEvent';
type BalanceEventJson = {
  amount: string;
  asset: { name: string };
  deposit: boolean;
};
const isBalanceEvent = (j: unknown): j is BalanceEventJson =>
  typeof j === 'object' &&
  j !== null &&
  typeof (j as { amount?: unknown }).amount === 'string' &&
  typeof (j as { deposit?: unknown }).deposit === 'boolean' &&
  typeof ((j as { asset?: { name?: unknown } }).asset?.name) === 'string';

/** Parse one transaction into a bet or cashout record for `owner` (its sender). */
export function parseTxForOwner(
  tx: TxBlock,
  owner: string,
): { bet?: BetTxRecord; cashout?: CashoutTxRecord } {
  if (tx.effects?.status.status !== 'success') return {};
  const ptb = tx.transaction?.data.transaction as
    | { kind: string; transactions: unknown[]; inputs: { value?: unknown }[] }
    | undefined;
  if (!ptb || ptb.kind !== 'ProgrammableTransaction') return {};
  const moveCalls = ptb.transactions.flatMap((c) =>
    typeof c === 'object' && c !== null && 'MoveCall' in c
      ? [(c as { MoveCall: MoveCallRef }).MoveCall]
      : [],
  );
  const keyCall = moveCalls.find((mc) => mc.module === 'market_key');
  if (!keyCall?.arguments || keyCall.arguments.length < 3) return {};

  const inputs = ptb.inputs;
  const inputValue = (arg: unknown): unknown => {
    const idx = (arg as { Input?: number }).Input;
    return idx !== undefined ? inputs[idx]?.value : undefined;
  };

  const oracleId = String(inputValue(keyCall.arguments[0]) ?? '');
  const expiry = Number(inputValue(keyCall.arguments[1]) ?? 0);
  const strikeRaw = Number(inputValue(keyCall.arguments[2]) ?? 0);
  if (!oracleId || !strikeRaw) return {};
  const common = {
    digest: tx.digest,
    timestampMs: Number(tx.timestampMs ?? 0),
    oracleId,
    expiry,
    strikeUsd: decodeScaled(strikeRaw),
    direction: (keyCall.function === 'up' ? 'UP' : 'DOWN') as Direction,
  };

  const ownDusdcChange = (sign: 1 | -1) =>
    tx.balanceChanges?.find(
      (b) =>
        b.coinType === DUSDC_COIN_TYPE &&
        typeof b.owner === 'object' &&
        b.owner !== null &&
        'AddressOwner' in b.owner &&
        (b.owner as { AddressOwner: string }).AddressOwner === owner &&
        Math.sign(Number(b.amount)) === sign,
    );

  const ptbCommands = ptb.transactions as unknown[];
  // Sponsored txs sometimes come back with balanceChanges=null even when the
  // RPC supposedly populates them — fall through to PTB / event introspection
  // and only use balanceChanges as a final fallback for unfamiliar shapes.
  const splitCoinsAmount = (arg: unknown): number | undefined => {
    const ref = arg as { Result?: number; NestedResult?: [number, number] };
    const idx = ref.NestedResult?.[0] ?? ref.Result;
    if (idx === undefined) return undefined;
    const cmd = ptbCommands[idx] as { SplitCoins?: [unknown, unknown[]] } | undefined;
    const amounts = cmd?.SplitCoins?.[1];
    if (!amounts || amounts.length === 0) return undefined;
    const raw = Number(inputValue(amounts[0]) ?? 0);
    return raw > 0 ? raw : undefined;
  };
  const lastDusdcBalanceEvent = (deposit: boolean): number | undefined => {
    const ev = tx.events;
    if (!ev) return undefined;
    let last: number | undefined;
    for (const e of ev) {
      if (!e.type.endsWith(DEEPBOOK_BALANCE_EVENT_SUFFIX)) continue;
      if (!isBalanceEvent(e.parsedJson)) continue;
      if (e.parsedJson.deposit !== deposit) continue;
      if (!e.parsedJson.asset.name.endsWith('::dusdc::DUSDC')) continue;
      last = Number(e.parsedJson.amount);
    }
    return last && last > 0 ? last : undefined;
  };

  const betCall = moveCalls.find((mc) => mc.function === 'place_bet');
  const cashoutCall = moveCalls.find((mc) => mc.function === 'cashout');
  if (betCall?.arguments) {
    // place_bet args: (predict, manager, oracle, key, quantity, payment, clock).
    // Stake = the SplitCoins amount that funded the payment coin. Robust to
    // sponsored txs where the RPC drops balanceChanges.
    const quantityRaw = Number(inputValue(betCall.arguments[4]) ?? 0);
    let stakeRaw = splitCoinsAmount(betCall.arguments[5]);
    if (stakeRaw === undefined) {
      const outflow = ownDusdcChange(-1);
      stakeRaw = outflow ? Math.abs(Number(outflow.amount)) : undefined;
    }
    if (stakeRaw === undefined) return {};
    return {
      bet: { ...common, stakeUsd: stakeRaw / DUSDC_SCALE, units: quantityRaw / DUSDC_SCALE },
    };
  }
  if (cashoutCall) {
    // Net dUSDC the user got back. Deepbook's balance_manager emits a
    // BalanceEvent(deposit=false) when withdrawing to the sender — that's the
    // user-facing payout. Fall back to balanceChanges if events are absent.
    let receivedRaw = lastDusdcBalanceEvent(false);
    if (receivedRaw === undefined) {
      const inflow = ownDusdcChange(1);
      receivedRaw = inflow ? Number(inflow.amount) : undefined;
    }
    if (receivedRaw === undefined) return {};
    return { cashout: { ...common, receivedUsd: receivedRaw / DUSDC_SCALE } };
  }
  return {};
}

export async function parseBetsFromHistory(
  client: SuiClient,
  owner: string,
): Promise<HistoryTxRecords> {
  const bets: BetTxRecord[] = [];
  const cashouts: CashoutTxRecord[] = [];
  let cursor: string | null | undefined = undefined;
  let fetched = 0;
  do {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: owner },
      options: { showInput: true, showBalanceChanges: true, showEffects: true, showEvents: true },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const tx of page.data) {
      const { bet, cashout } = parseTxForOwner(tx, owner);
      if (bet) bets.push(bet);
      if (cashout) cashouts.push(cashout);
    }
    fetched += page.data.length;
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor && fetched < MAX_HISTORY_TXS);
  return { bets, cashouts, truncated: !!cursor };
}
