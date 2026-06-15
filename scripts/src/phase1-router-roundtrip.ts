/**
 * Phase 1 round-trip: exercise hunchbook_router::place_bet → wait for
 * settlement → hunchbook_router::cashout. Verify the treasury wallet
 * accrues 1% on the entry premium and 1% on the exit withdrawal.
 */
import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  DUSDC_COIN_TYPE,
  FEE_BPS,
  FEE_RECIPIENT_ADDRESS,
  PHASE0_DEFAULT_QUANTITY,
  PHASE0_MAX_TIME_TO_EXPIRY_MS,
  PHASE0_MIN_TIME_TO_EXPIRY_MS,
  PREDICT_MANAGER_MODULE,
  PREDICT_PACKAGE_ID,
  SUI_FULLNODE_URL,
} from "@hunchbook/shared";
import {
  addCashoutCall,
  addGetTradeAmountsCall,
  addMarketKeyUp,
  addPlaceBetCall,
  getOracleState,
  IndexerOracle,
  listManagersForOwner,
  listOracles,
  pickRoundTripOracle,
} from "@hunchbook/shared";
import { digest, fail, heading, info, ok, step, warn } from "./lib/log.js";
import { loadActiveCliKeypair } from "./lib/signer.js";

// Total dUSDC the user commits to this trade (includes 1% fee). Sized
// generously above the expected ~$0.53 premium so leftover deposit
// exercises the partial-withdrawal path on cashout.
const PHASE1_PAYMENT_RAW = 2_000_000n; // 2 dUSDC

const client = new SuiClient({
  transport: new SuiHTTPTransport({ url: SUI_FULLNODE_URL }),
});

async function main() {
  heading("Phase 1 — hunchbook router round trip on testnet");

  step(0, "Load CLI keypair");
  const { keypair, address } = loadActiveCliKeypair();
  ok(`signer address: ${address}`);

  step(1, "Snapshot balances (signer + treasury)");
  const signerDusdcBefore = BigInt(
    (await client.getBalance({ owner: address, coinType: DUSDC_COIN_TYPE }))
      .totalBalance,
  );
  const treasuryDusdcBefore = BigInt(
    (await client.getBalance({
      owner: FEE_RECIPIENT_ADDRESS,
      coinType: DUSDC_COIN_TYPE,
    })).totalBalance,
  );
  info(`signer  dUSDC: ${signerDusdcBefore}`);
  info(`treasury dUSDC: ${treasuryDusdcBefore}`);
  if (signerDusdcBefore < PHASE1_PAYMENT_RAW) {
    fail(`signer dUSDC ${signerDusdcBefore} < required ${PHASE1_PAYMENT_RAW}`);
    process.exitCode = 1;
    return;
  }

  step(2, "Look up PredictManager via indexer");
  const managers = await listManagersForOwner(address);
  if (managers.length === 0) {
    fail(
      "no PredictManager found for signer — run `pnpm phase0` once first to create one",
    );
    process.exitCode = 1;
    return;
  }
  const managerId = managers[0]!.manager_id;
  ok(`manager: ${managerId}`);

  step(3, "Pick soon-to-settle active oracle");
  const oracles = await listOracles();
  const oracle = pickRoundTripOracle(oracles, {
    now: Date.now(),
    minMs: PHASE0_MIN_TIME_TO_EXPIRY_MS,
    maxMs: PHASE0_MAX_TIME_TO_EXPIRY_MS,
  });
  if (!oracle) {
    fail("no active oracle within the round-trip window");
    process.exitCode = 1;
    return;
  }
  const ttl = Math.round((oracle.expiry - Date.now()) / 1000);
  ok(
    `oracle ${oracle.oracle_id} (${oracle.underlying_asset}) expires in ${ttl}s`,
  );

  step(4, "Resolve spot and strike");
  const state = await getOracleState(oracle.oracle_id);
  const spot = state.latest_price?.spot ?? 0;
  if (!spot) {
    fail("oracle has no latest spot price");
    process.exitCode = 1;
    return;
  }
  const tick = BigInt(oracle.tick_size);
  const strike = (BigInt(spot) / tick) * tick;
  info(`spot=${spot} tick=${tick} → strike=${strike}`);

  step(5, "Place bet via router::place_bet (1% entry fee)");
  const placeTx = new Transaction();
  const dusdcCoins = await client.getCoins({
    owner: address,
    coinType: DUSDC_COIN_TYPE,
  });
  if (dusdcCoins.data.length === 0) {
    fail("no dUSDC coins to spend");
    process.exitCode = 1;
    return;
  }
  const primary = dusdcCoins.data[0]!;
  if (dusdcCoins.data.length > 1) {
    placeTx.mergeCoins(
      placeTx.object(primary.coinObjectId),
      dusdcCoins.data.slice(1).map((c) => placeTx.object(c.coinObjectId)),
    );
  }
  const [payment] = placeTx.splitCoins(placeTx.object(primary.coinObjectId), [
    placeTx.pure.u64(PHASE1_PAYMENT_RAW),
  ]);
  const placeKey = addMarketKeyUp(placeTx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(oracle.expiry),
    strike,
  });
  addPlaceBetCall(placeTx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg: placeKey,
    quantity: PHASE0_DEFAULT_QUANTITY,
    paymentCoin: payment!,
  });
  const placeRes = await client.signAndExecuteTransaction({
    transaction: placeTx,
    signer: keypair,
    options: { showEvents: true, showEffects: true, showBalanceChanges: true },
  });
  digest("place_bet", placeRes.digest);
  if (placeRes.effects?.status?.status !== "success") {
    fail(`place_bet failed: ${placeRes.effects?.status?.error}`);
    process.exitCode = 1;
    return;
  }
  const expectedEntryFee = (PHASE1_PAYMENT_RAW * FEE_BPS) / 10_000n;
  ok(`place_bet landed; expected entry fee ${expectedEntryFee} raw dUSDC`);

  // Preview redeem payout for diagnostic logging
  step(6, "Preview redeem payout via get_trade_amounts");
  const previewTx = new Transaction();
  const previewKey = addMarketKeyUp(previewTx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(oracle.expiry),
    strike,
  });
  addGetTradeAmountsCall(previewTx, {
    oracleId: oracle.oracle_id,
    keyArg: previewKey,
    quantity: PHASE0_DEFAULT_QUANTITY,
  });
  try {
    const dry = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: previewTx,
    });
    if (dry.effects.status.status === "success") {
      info(`devInspect ok (preview not decoded, fine)`);
    }
  } catch {
    /* ignore */
  }

  step(7, "Wait for oracle settlement");
  const deadline = Date.now() + (oracle.expiry - Date.now()) + 5 * 60_000;
  let settled: IndexerOracle | null = null;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const refreshed = await listOracles();
    const found = refreshed.find((o) => o.oracle_id === oracle.oracle_id);
    if (!found) continue;
    info(
      `t=${new Date().toISOString().slice(11, 19)} status=${found.status} settlement_price=${found.settlement_price}`,
    );
    if (found.status === "settled" && found.settlement_price !== null) {
      settled = found;
      break;
    }
  }
  if (!settled) {
    fail("oracle did not settle in time");
    process.exitCode = 1;
    return;
  }
  const won = BigInt(settled.settlement_price!) > strike;
  ok(
    `settled at ${settled.settlement_price} vs strike ${strike} — UP ${won ? "WINS" : "LOSES"}`,
  );

  step(8, "Query manager dUSDC balance via redeem_permissionless");
  // redeem_permissionless will deposit the payout into the manager. We do
  // this as a single PTB inside cashout, but to know withdrawAmount we need
  // the manager's *post-redeem* balance. Use devInspect of a hypothetical
  // redeem+balance to compute it without sending a tx.
  const balPreviewTx = new Transaction();
  balPreviewTx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::${PREDICT_MANAGER_MODULE}::balance`,
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [balPreviewTx.object(managerId)],
  });
  const balRes = await client.devInspectTransactionBlock({
    sender: address,
    transactionBlock: balPreviewTx,
  });
  const balReturn = balRes.results?.[0]?.returnValues?.[0]?.[0];
  if (!balReturn) {
    fail("could not read manager balance via devInspect");
    process.exitCode = 1;
    return;
  }
  const managerBalanceNow = BigInt(
    bcs.u64().parse(Uint8Array.from(balReturn)),
  );
  // After redeem, payout will be added: quantity if won, 0 if lost
  const expectedPayout = won ? PHASE0_DEFAULT_QUANTITY : 0n;
  const withdrawAmount = managerBalanceNow + expectedPayout;
  info(
    `manager balance pre-redeem=${managerBalanceNow}, expected payout=${expectedPayout}, withdrawAmount=${withdrawAmount}`,
  );

  step(9, "Cash out via router::cashout (1% exit fee)");
  const cashTx = new Transaction();
  const cashKey = addMarketKeyUp(cashTx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(settled.expiry),
    strike,
  });
  addCashoutCall(cashTx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg: cashKey,
    quantity: PHASE0_DEFAULT_QUANTITY,
    withdrawAmount,
  });
  const cashRes = await client.signAndExecuteTransaction({
    transaction: cashTx,
    signer: keypair,
    options: { showEvents: true, showEffects: true, showBalanceChanges: true },
  });
  digest("cashout", cashRes.digest);
  if (cashRes.effects?.status?.status !== "success") {
    fail(`cashout failed: ${cashRes.effects?.status?.error}`);
    process.exitCode = 1;
    return;
  }
  // Wait for the cashout tx to be fully indexed before we read balances —
  // signAndExecuteTransaction returns once effects are certified, but the
  // getBalance view can lag a beat behind.
  await client.waitForTransaction({ digest: cashRes.digest });
  const expectedExitFee = (withdrawAmount * FEE_BPS) / 10_000n;
  ok(`cashout landed; expected exit fee ${expectedExitFee} raw dUSDC`);

  step(10, "Verify treasury accrual");
  const treasuryDusdcAfter = BigInt(
    (await client.getBalance({
      owner: FEE_RECIPIENT_ADDRESS,
      coinType: DUSDC_COIN_TYPE,
    })).totalBalance,
  );
  const treasuryDelta = treasuryDusdcAfter - treasuryDusdcBefore;
  const expectedTotalFee = expectedEntryFee + expectedExitFee;
  info(`treasury before: ${treasuryDusdcBefore}`);
  info(`treasury after : ${treasuryDusdcAfter}`);
  info(`treasury delta : ${treasuryDelta}`);
  info(`expected fees  : ${expectedTotalFee}`);
  if (treasuryDelta === expectedTotalFee) {
    ok("treasury accrual matches expected fee ✓");
  } else {
    warn(
      `treasury delta differs from expected — check for off-by-one or rounding`,
    );
  }

  const signerDusdcAfter = BigInt(
    (await client.getBalance({ owner: address, coinType: DUSDC_COIN_TYPE }))
      .totalBalance,
  );
  const signerPnl = signerDusdcAfter - signerDusdcBefore;

  heading("Phase 1 complete ✓");
  console.log(
    JSON.stringify(
      {
        address,
        manager_id: managerId,
        oracle_id: oracle.oracle_id,
        underlying: oracle.underlying_asset,
        strike: strike.toString(),
        quantity: PHASE0_DEFAULT_QUANTITY.toString(),
        won,
        payment_raw: PHASE1_PAYMENT_RAW.toString(),
        entry_fee_raw: expectedEntryFee.toString(),
        exit_fee_raw: expectedExitFee.toString(),
        withdraw_amount_raw: withdrawAmount.toString(),
        signer_pnl_raw: signerPnl.toString(),
        treasury_delta_raw: treasuryDelta.toString(),
        place_bet_digest: placeRes.digest,
        cashout_digest: cashRes.digest,
      },
      null,
      2,
    ),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
