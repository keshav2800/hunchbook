import {
  Transaction,
  type TransactionObjectArgument,
} from "@mysten/sui/transactions";
import {
  DUSDC_COIN_TYPE,
  PREDICT_OBJECT_ID,
  ROUTER_MODULE,
  ROUTER_PACKAGE_ID,
  SUI_CLOCK_OBJECT_ID,
} from "./config";

const T = (fn: string) =>
  `${ROUTER_PACKAGE_ID}::${ROUTER_MODULE}::${fn}` as const;

/**
 * router::place_bet — split 1% fee → treasury, deposit net into manager,
 * mint the position. The keyArg should be built by addMarketKeyUp/Down
 * (from ./predict.ts) in the same PTB.
 */
export function addPlaceBetCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
    paymentCoin: TransactionObjectArgument;
  },
) {
  tx.moveCall({
    target: T("place_bet"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      args.paymentCoin,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

/**
 * router::cashout — redeem position into the manager's internal balance,
 * withdraw `withdrawAmount`, split 1% fee → treasury, send the rest to the
 * tx sender. Use withdrawAmount = position payout (in raw dUSDC) to cash
 * out exactly the redemption proceeds.
 */
export function addCashoutCall(
  tx: Transaction,
  args: {
    managerId: string;
    oracleId: string;
    keyArg: ReturnType<Transaction["moveCall"]>;
    quantity: bigint;
    withdrawAmount: bigint;
  },
) {
  tx.moveCall({
    target: T("cashout"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      args.keyArg,
      tx.pure.u64(args.quantity),
      tx.pure.u64(args.withdrawAmount),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}
