import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  DUSDC_COIN_TYPE,
  MARKET_KEY_MODULE,
  PREDICT_MANAGER_MODULE,
  PREDICT_MODULE,
  PREDICT_OBJECT_ID,
  PREDICT_PACKAGE_ID,
  RANGE_KEY_MODULE,
  SUI_CLOCK_OBJECT_ID,
} from "./config";

const T = (mod: string, fn: string) =>
  `${PREDICT_PACKAGE_ID}::${mod}::${fn}` as const;

export function buildCreateManagerTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: T(PREDICT_MODULE, "create_manager"),
    arguments: [],
  });
  return tx;
}

export function addDepositDusdcCall(
  tx: Transaction,
  args: { managerId: string; coinArg: TransactionObjectArgument },
) {
  tx.moveCall({
    target: T(PREDICT_MANAGER_MODULE, "deposit"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [tx.object(args.managerId), args.coinArg],
  });
}

export function addMarketKeyUp(
  tx: Transaction,
  args: { oracleId: string; expiry: bigint; strike: bigint },
) {
  return tx.moveCall({
    target: T(MARKET_KEY_MODULE, "up"),
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiry),
      tx.pure.u64(args.strike),
    ],
  });
}

export function addMarketKeyDown(
  tx: Transaction,
  args: { oracleId: string; expiry: bigint; strike: bigint },
) {
  return tx.moveCall({
    target: T(MARKET_KEY_MODULE, "down"),
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiry),
      tx.pure.u64(args.strike),
    ],
  });
}

export function addMintCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  tx.moveCall({
    target: T(PREDICT_MODULE, "mint"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function addRedeemCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  tx.moveCall({
    target: T(PREDICT_MODULE, "redeem"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function addGetTradeAmountsCall(
  tx: Transaction,
  args: {
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  return tx.moveCall({
    target: T(PREDICT_MODULE, "get_trade_amounts"),
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Range positions — "BTC ends in (lower, higher]" bet.
// Range bets pay $1·quantity if settlement lands in the band, else partial.
// ──────────────────────────────────────────────────────────────────────────

export function addRangeKey(
  tx: Transaction,
  args: {
    oracleId: string;
    expiry: bigint;
    lowerStrike: bigint;
    higherStrike: bigint;
  },
) {
  return tx.moveCall({
    target: T(RANGE_KEY_MODULE, "new"),
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiry),
      tx.pure.u64(args.lowerStrike),
      tx.pure.u64(args.higherStrike),
    ],
  });
}

export function addMintRangeCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  tx.moveCall({
    target: T(PREDICT_MODULE, "mint_range"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function addRedeemRangeCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  tx.moveCall({
    target: T(PREDICT_MODULE, "redeem_range"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function addGetRangeTradeAmountsCall(
  tx: Transaction,
  args: {
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
  },
) {
  return tx.moveCall({
    target: T(PREDICT_MODULE, "get_range_trade_amounts"),
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}
