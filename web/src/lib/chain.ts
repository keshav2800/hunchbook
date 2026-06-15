import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import type { SuiClient } from '@mysten/sui/client';
import {
  DUSDC_COIN_TYPE,
  PF_SHARE_COIN_TYPE,
  PREDICT_MANAGER_MODULE,
  PREDICT_MODULE,
  PREDICT_OBJECT_ID,
  PREDICT_PACKAGE_ID,
  VAULT_MANAGER_ID,
  VAULT_MODULE,
  VAULT_OBJECT_ID,
  VAULT_PACKAGE_ID,
  addCashoutCall,
  addDepositDusdcCall,
  addGetRangeTradeAmountsCall,
  addGetTradeAmountsCall,
  addMarketKeyDown,
  addMarketKeyUp,
  addMintRangeCall,
  addPlaceBetCall,
  addRangeKey,
  buildCreateManagerTx,
} from '@hunchbook/shared';
import type { BetPosition, Direction, LiveMarket } from '@/lib/types';

export const DUSDC_SCALE = 1e6; // dUSDC has 6 decimals
export const STRIKE_SCALE = 1e9; // on-chain prices/strikes are u64 × 1e9

export { buildCreateManagerTx, DUSDC_COIN_TYPE };

export async function getDusdcBalance(client: SuiClient, owner: string): Promise<number> {
  const bal = await client.getBalance({ owner, coinType: DUSDC_COIN_TYPE });
  return Number(bal.totalBalance) / DUSDC_SCALE;
}

const ONE_UNIT_RAW = 1_000_000n; // one $1-payout unit, dUSDC 6 decimals

/** Identifies a market position: enough to rebuild its on-chain MarketKey. */
export interface KeyParams {
  oracleId: string;
  expiry: number; // unix ms
  strikeUsd: number;
  direction: Direction;
  tickSizeUsd?: number; // defaults to $1 (BTC oracle tick)
}

function addKey(tx: Transaction, k: KeyParams) {
  const args = {
    oracleId: k.oracleId,
    expiry: BigInt(k.expiry),
    strike: strikeToRaw(k.strikeUsd, k.tickSizeUsd ?? 1),
  };
  return k.direction === 'UP' ? addMarketKeyUp(tx, args) : addMarketKeyDown(tx, args);
}

/**
 * Exact on-chain (ask cost, bid proceeds) in raw dUSDC for a quantity, via
 * devInspect of predict::get_trade_amounts. The protocol's prices include
 * its spread, so this — not the SVI fair value — is what trades settle at.
 */
export async function quoteTradeAmountsRaw(args: {
  client: SuiClient;
  sender: string;
  key: KeyParams;
  quantityRaw: bigint;
}): Promise<{ askRaw: bigint; bidRaw: bigint }> {
  const { client, sender, key, quantityRaw } = args;
  const tx = new Transaction();
  const keyArg = addKey(tx, key);
  addGetTradeAmountsCall(tx, { oracleId: key.oracleId, keyArg, quantity: quantityRaw });

  const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  const ret = res.results?.at(-1)?.returnValues;
  if (res.error || !ret?.[0] || !ret[1]) {
    throw new Error(`Price quote failed: ${res.error ?? 'no return values'}`);
  }
  return {
    askRaw: BigInt(bcs.u64().parse(Uint8Array.from(ret[0][0]))),
    bidRaw: BigInt(bcs.u64().parse(Uint8Array.from(ret[1][0]))),
  };
}

/** Snap a USD strike to the oracle tick grid, in raw 1e9 units. */
export function strikeToRaw(strikeUsd: number, tickSizeUsd: number): bigint {
  const tickRaw = BigInt(Math.round(tickSizeUsd * STRIKE_SCALE));
  const raw = BigInt(Math.round(strikeUsd * STRIKE_SCALE));
  return (raw / tickRaw) * tickRaw;
}

/**
 * Build the bet PTB, mirroring scripts/src/phase1-router-roundtrip.ts:
 * merge dUSDC coins → split payment → market key → router::place_bet.
 */
export async function buildPlaceBetTx(args: {
  client: SuiClient;
  sender: string;
  managerId: string;
  market: LiveMarket;
  direction: Direction;
  strikeUsd: number;
  stakeUsd: number;
}): Promise<Transaction> {
  const { client, sender, managerId, market, direction, strikeUsd, stakeUsd } = args;

  // Exact protocol ask price — sizes the quantity so the net stake covers cost.
  const { askRaw: askPerUnitRaw } = await quoteTradeAmountsRaw({
    client,
    sender,
    key: { oracleId: market.oracleId, expiry: market.expiry, strikeUsd, direction, tickSizeUsd: market.tickSize },
    quantityRaw: ONE_UNIT_RAW,
  });
  if (askPerUnitRaw === 0n) throw new Error('Price quote returned zero — market may be untradeable.');

  const tx = new Transaction();
  tx.setSender(sender);

  const coins = await client.getCoins({ owner: sender, coinType: DUSDC_COIN_TYPE });
  if (coins.data.length === 0) throw new Error('No dUSDC in wallet — use the faucet first.');
  const primary = coins.data[0]!;
  if (coins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }

  const stakeRaw = BigInt(Math.round(stakeUsd * DUSDC_SCALE));
  const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
  if (total < stakeRaw) {
    throw new Error(`Insufficient dUSDC: have ${Number(total) / DUSDC_SCALE}, need ${stakeUsd}.`);
  }
  const [payment] = tx.splitCoins(tx.object(primary.coinObjectId), [tx.pure.u64(stakeRaw)]);

  const keyArg = addKey(tx, {
    oracleId: market.oracleId,
    expiry: market.expiry,
    strikeUsd,
    direction,
    tickSizeUsd: market.tickSize,
  });

  // Net of the router's 1% fee, sized at 90% — on-chain spot ticks every ~1s
  // and the ATM ask can move ~2% per tick, so a thin margin aborts with
  // EBalanceManagerBalanceTooLow. The unused margin stays as manager balance
  // (reclaimable via cashout), it is not lost.
  const netRaw = (stakeRaw * 99n) / 100n;
  const quantity = (netRaw * ONE_UNIT_RAW * 90n) / (askPerUnitRaw * 100n);
  if (quantity === 0n) {
    throw new Error('Stake too small for this market — increase the stake.');
  }

  addPlaceBetCall(tx, {
    managerId,
    oracleId: market.oracleId,
    keyArg,
    quantity,
    paymentCoin: payment!,
  });

  return tx;
}

/**
 * Exact on-chain (ask cost, bid proceeds) for a range position, via
 * devInspect of predict::get_range_trade_amounts, plus the oracle's
 * [min, max] mintable ask bounds (1e9 price fractions) from the same inspect.
 */
export async function quoteRangeTradeAmountsRaw(args: {
  client: SuiClient;
  sender: string;
  market: LiveMarket;
  lowerUsd: number;
  upperUsd: number;
  quantityRaw: bigint;
}): Promise<{ askRaw: bigint; bidRaw: bigint; minAskRaw: bigint; maxAskRaw: bigint }> {
  const { client, sender, market, lowerUsd, upperUsd, quantityRaw } = args;
  const tx = new Transaction();
  const keyArg = addRangeKey(tx, {
    oracleId: market.oracleId,
    expiry: BigInt(market.expiry),
    lowerStrike: strikeToRaw(lowerUsd, market.tickSize),
    higherStrike: strikeToRaw(upperUsd, market.tickSize),
  });
  addGetRangeTradeAmountsCall(tx, { oracleId: market.oracleId, keyArg, quantity: quantityRaw });
  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::ask_bounds`,
    arguments: [tx.object(PREDICT_OBJECT_ID), tx.pure.id(market.oracleId)],
  });

  const res = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  // Commands: [0] range_key::new, [1] get_range_trade_amounts, [2] ask_bounds.
  const ret = res.results?.[1]?.returnValues;
  const bounds = res.results?.[2]?.returnValues;
  if (res.error || !ret?.[0] || !ret[1] || !bounds?.[0] || !bounds[1]) {
    throw new Error(`Range quote failed: ${res.error ?? 'no return values'}`);
  }
  return {
    askRaw: BigInt(bcs.u64().parse(Uint8Array.from(ret[0][0]))),
    bidRaw: BigInt(bcs.u64().parse(Uint8Array.from(ret[1][0]))),
    minAskRaw: BigInt(bcs.u64().parse(Uint8Array.from(bounds[0][0]))),
    maxAskRaw: BigInt(bcs.u64().parse(Uint8Array.from(bounds[1][0]))),
  };
}

/**
 * Build a range-bet PTB: merge dUSDC → split stake → deposit into the
 * PredictManager → range key → predict::mint_range.
 *
 * Unlike single-strike bets this does NOT go through the hunchbook router
 * (router::place_bet is typed to MarketKey), so no 1% entry fee is charged on
 * ranges until the router grows a place_range_bet — tracked as a follow-up.
 * mint_range pulls the exact premium from the manager balance; the unused
 * sizing margin stays in the manager, reclaimable like any other dust.
 */
export async function buildPlaceRangeBetTx(args: {
  client: SuiClient;
  sender: string;
  managerId: string;
  market: LiveMarket;
  lowerUsd: number;
  upperUsd: number;
  stakeUsd: number;
}): Promise<Transaction> {
  const { client, sender, managerId, market, lowerUsd, upperUsd, stakeUsd } = args;

  const { askRaw: askPerUnitRaw, minAskRaw, maxAskRaw } = await quoteRangeTradeAmountsRaw({
    client,
    sender,
    market,
    lowerUsd,
    upperUsd,
    quantityRaw: ONE_UNIT_RAW,
  });
  if (askPerUnitRaw === 0n) throw new Error('Range quote returned zero — market may be untradeable.');

  // mint_range only sells asks inside the oracle's [min, max] band
  // (assert_mintable_ask aborts otherwise) — fail with something actionable
  // instead of letting the sponsor dry-run surface a MoveAbort. Per-unit ask
  // is dUSDC 1e6; bounds are 1e9 price fractions.
  const askScaled = askPerUnitRaw * 1_000n;
  const cents = (raw1e9: bigint) => `${Math.round(Number(raw1e9) / 1e7)}¢`;
  if (askScaled > maxAskRaw) {
    throw new Error(
      `Band too likely to win: this contract costs ${cents(askScaled)}, above the protocol max of ${cents(maxAskRaw)}. Narrow the band or move it off the current price.`,
    );
  }
  if (askScaled < minAskRaw) {
    throw new Error(
      `Band too unlikely to win: this contract costs ${cents(askScaled)}, below the protocol min of ${cents(minAskRaw)}. Move the band closer to the current price.`,
    );
  }

  const tx = new Transaction();
  tx.setSender(sender);

  const coins = await client.getCoins({ owner: sender, coinType: DUSDC_COIN_TYPE });
  if (coins.data.length === 0) throw new Error('No dUSDC in wallet — use the faucet first.');
  const primary = coins.data[0]!;
  if (coins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }

  const stakeRaw = BigInt(Math.round(stakeUsd * DUSDC_SCALE));
  const total = coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n);
  if (total < stakeRaw) {
    throw new Error(`Insufficient dUSDC: have ${Number(total) / DUSDC_SCALE}, need ${stakeUsd}.`);
  }
  const [payment] = tx.splitCoins(tx.object(primary.coinObjectId), [tx.pure.u64(stakeRaw)]);

  addDepositDusdcCall(tx, { managerId, coinArg: payment! });

  const keyArg = addRangeKey(tx, {
    oracleId: market.oracleId,
    expiry: BigInt(market.expiry),
    lowerStrike: strikeToRaw(lowerUsd, market.tickSize),
    higherStrike: strikeToRaw(upperUsd, market.tickSize),
  });

  // Same 90% sizing margin as single-strike bets: the on-chain ask moves with
  // each ~1s spot tick, and a thin margin aborts the mint. No router fee here.
  const quantity = (stakeRaw * ONE_UNIT_RAW * 90n) / (askPerUnitRaw * 100n);
  if (quantity === 0n) {
    throw new Error('Stake too small for this market — increase the stake.');
  }

  addMintRangeCall(tx, { managerId, oracleId: market.oracleId, keyArg, quantity });

  return tx;
}

/**
 * Cash out a position via router::cashout: redeem proceeds into the manager,
 * withdraw `withdrawRaw` (1% exit fee skimmed), rest sent to the sender.
 * Settled wins: withdrawRaw = full payout. Active bets: quoted bid × margin.
 */
/**
 * Withdraw internal manager balance (auto-settled winnings + sizing dust)
 * straight to the owner's wallet via predict_manager::withdraw.
 */
export function buildWithdrawBalanceTx(args: {
  sender: string;
  managerId: string;
  amountRaw: bigint;
}): Transaction {
  const { sender, managerId, amountRaw } = args;
  const tx = new Transaction();
  tx.setSender(sender);
  const [coin] = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::${PREDICT_MANAGER_MODULE}::withdraw`,
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [tx.object(managerId), tx.pure.u64(amountRaw)],
  });
  tx.transferObjects([coin!], sender);
  return tx;
}

/** Merge all of `owner`'s coins of `coinType` into one usable PTB object. */
async function mergeAllCoins(
  tx: Transaction,
  client: SuiClient,
  owner: string,
  coinType: string,
): Promise<{ primaryId: string; totalRaw: bigint }> {
  const coins = await client.getCoins({ owner, coinType });
  if (coins.data.length === 0) return { primaryId: '', totalRaw: 0n };
  const primary = coins.data[0]!;
  if (coins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  return {
    primaryId: primary.coinObjectId,
    totalRaw: coins.data.reduce((acc, c) => acc + BigInt(c.balance), 0n),
  };
}

const VAULT_TARGET = (fn: string) => `${VAULT_PACKAGE_ID}::${VAULT_MODULE}::${fn}`;

export async function getPfShareBalanceRaw(client: SuiClient, owner: string): Promise<bigint> {
  const bal = await client.getBalance({ owner, coinType: PF_SHARE_COIN_TYPE });
  return BigInt(bal.totalBalance);
}

/** Deposit dUSDC into the vault; PFSHARE shares land in the sender's wallet. */
export async function buildVaultDepositTx(args: {
  client: SuiClient;
  sender: string;
  amountUsd: number;
}): Promise<Transaction> {
  const { client, sender, amountUsd } = args;
  const amountRaw = BigInt(Math.round(amountUsd * DUSDC_SCALE));
  if (amountRaw <= 0n) throw new Error('Enter an amount to deposit.');

  const tx = new Transaction();
  tx.setSender(sender);
  const { primaryId, totalRaw } = await mergeAllCoins(tx, client, sender, DUSDC_COIN_TYPE);
  if (totalRaw < amountRaw) {
    throw new Error(
      `Insufficient dUSDC: have ${Number(totalRaw) / DUSDC_SCALE}, need ${amountUsd}.`,
    );
  }
  const [payment] = tx.splitCoins(tx.object(primaryId), [tx.pure.u64(amountRaw)]);
  const [shares] = tx.moveCall({
    target: VAULT_TARGET('deposit'),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [tx.object(VAULT_OBJECT_ID), tx.object(VAULT_MANAGER_ID), payment!],
  });
  tx.transferObjects([shares!], sender);
  return tx;
}

/** Burn `sharesRaw` PFSHARE for a proportional dUSDC payout to the sender. */
export async function buildVaultWithdrawTx(args: {
  client: SuiClient;
  sender: string;
  sharesRaw: bigint;
}): Promise<Transaction> {
  const { client, sender, sharesRaw } = args;
  if (sharesRaw <= 0n) throw new Error('Enter an amount to withdraw.');

  const tx = new Transaction();
  tx.setSender(sender);
  const { primaryId, totalRaw } = await mergeAllCoins(tx, client, sender, PF_SHARE_COIN_TYPE);
  if (totalRaw < sharesRaw) throw new Error('Not enough vault shares for that amount.');
  const [shares] = tx.splitCoins(tx.object(primaryId), [tx.pure.u64(sharesRaw)]);
  const [quote] = tx.moveCall({
    target: VAULT_TARGET('withdraw'),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [tx.object(VAULT_OBJECT_ID), tx.object(VAULT_MANAGER_ID), shares!],
  });
  tx.transferObjects([quote!], sender);
  return tx;
}

export function buildCashoutTx(args: {
  sender: string;
  managerId: string;
  position: BetPosition;
  withdrawRaw: bigint;
}): Transaction {
  const { sender, managerId, position, withdrawRaw } = args;
  const tx = new Transaction();
  tx.setSender(sender);
  const keyArg = addKey(tx, position);
  addCashoutCall(tx, {
    managerId,
    oracleId: position.oracleId,
    keyArg,
    quantity: BigInt(Math.round(position.units * DUSDC_SCALE)),
    withdrawAmount: withdrawRaw,
  });
  return tx;
}
