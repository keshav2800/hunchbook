import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import {
  DUSDC_COIN_TYPE,
  PHASE0_BUDGET_DUSDC_RAW,
  PHASE0_DEFAULT_QUANTITY,
  PHASE0_MAX_TIME_TO_EXPIRY_MS,
  PHASE0_MIN_TIME_TO_EXPIRY_MS,
  PREDICT_PACKAGE_ID,
  SUI_FULLNODE_URL,
} from "@hunchbook/shared";
import {
  addDepositDusdcCall,
  addGetTradeAmountsCall,
  addMarketKeyUp,
  addMintCall,
  addRedeemCall,
  getOracleState,
  IndexerOracle,
  listManagersForOwner,
  listOracles,
  pickRoundTripOracle,
} from "@hunchbook/shared";
import { digest, fail, heading, info, ok, step, warn } from "./lib/log.js";
import { loadActiveCliKeypair } from "./lib/signer.js";

const client = new SuiClient({
  transport: new SuiHTTPTransport({ url: SUI_FULLNODE_URL }),
});

async function main() {
  heading("Phase 0 — DeepBook Predict round trip on testnet");

  // ── Signer ────────────────────────────────────────────────────────────────
  step(0, "Load CLI keypair");
  const { keypair, address } = loadActiveCliKeypair();
  ok(`signer address: ${address}`);

  // ── Balances ──────────────────────────────────────────────────────────────
  step(1, "Check SUI + dUSDC balances");
  const suiBal = await client.getBalance({ owner: address });
  info(`SUI: ${suiBal.totalBalance}`);
  if (BigInt(suiBal.totalBalance) < 50_000_000n) {
    warn(
      "SUI balance is low (<0.05). Run `sui client faucet` if a tx fails for gas.",
    );
  }
  const dusdcBal = await client.getBalance({
    owner: address,
    coinType: DUSDC_COIN_TYPE,
  });
  info(`dUSDC: ${dusdcBal.totalBalance}`);
  if (BigInt(dusdcBal.totalBalance) < PHASE0_BUDGET_DUSDC_RAW) {
    fail(
      `dUSDC balance (${dusdcBal.totalBalance}) is below Phase 0 budget (${PHASE0_BUDGET_DUSDC_RAW}). Submit the tally form and wait for funding.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── PredictManager ────────────────────────────────────────────────────────
  step(2, "Ensure PredictManager exists");
  let managerId = process.env.PREDICT_MANAGER_ID || null;
  if (!managerId) {
    try {
      const managers = await listManagersForOwner(address);
      if (managers[0]) managerId = managers[0].manager_id;
    } catch (err) {
      warn(`indexer manager lookup failed: ${(err as Error).message}`);
    }
  }
  if (managerId) {
    ok(`reusing existing manager: ${managerId}`);
  } else {
    info("no manager found — calling predict::create_manager");
    const tx = new Transaction();
    tx.moveCall({
      target: `${PREDICT_PACKAGE_ID}::predict::create_manager`,
      arguments: [],
    });
    const res = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEvents: true, showObjectChanges: true, showEffects: true },
    });
    digest("create_manager", res.digest);
    if (res.effects?.status?.status !== "success") {
      fail(`create_manager failed: ${res.effects?.status?.error}`);
      process.exitCode = 1;
      return;
    }
    const created = (res.events ?? []).find((e) =>
      e.type.endsWith("::predict_manager::PredictManagerCreated"),
    );
    const parsed = created?.parsedJson as { manager_id?: string } | undefined;
    managerId = parsed?.manager_id ?? null;
    if (!managerId) {
      // Fallback: scan created shared objects
      const sharedManager = res.objectChanges?.find(
        (c) =>
          c.type === "created" &&
          "objectType" in c &&
          c.objectType?.includes("::predict_manager::PredictManager"),
      );
      if (sharedManager && "objectId" in sharedManager) {
        managerId = sharedManager.objectId as string;
      }
    }
    if (!managerId) {
      fail("could not extract manager_id from tx response");
      process.exitCode = 1;
      return;
    }
    ok(`manager created: ${managerId}`);
  }

  // ── Pick a market ─────────────────────────────────────────────────────────
  step(3, "Pick a soon-to-settle active oracle");
  const oracles = await listOracles();
  info(`indexer returned ${oracles.length} oracles`);
  const now = Date.now();
  const oracle = pickRoundTripOracle(oracles, {
    now,
    minMs: PHASE0_MIN_TIME_TO_EXPIRY_MS,
    maxMs: PHASE0_MAX_TIME_TO_EXPIRY_MS,
  });
  if (!oracle) {
    fail(
      `no active oracle within [${PHASE0_MIN_TIME_TO_EXPIRY_MS / 1000}s, ${
        PHASE0_MAX_TIME_TO_EXPIRY_MS / 60_000
      }min] of now. Try again in a minute.`,
    );
    process.exitCode = 1;
    return;
  }
  const ttl = Math.round((oracle.expiry - now) / 1000);
  ok(
    `oracle ${oracle.oracle_id} (${oracle.underlying_asset}) expires in ${ttl}s`,
  );

  // ── Pick a strike near spot ───────────────────────────────────────────────
  step(4, "Resolve current spot and pick a strike");
  const state = await getOracleState(oracle.oracle_id);
  const spot = state.latest_price?.spot ?? 0;
  if (!spot) {
    fail(
      `oracle state has no latest_price.spot (${JSON.stringify(state).slice(0, 200)})`,
    );
    process.exitCode = 1;
    return;
  }
  const tick = BigInt(oracle.tick_size);
  const strike = (BigInt(spot) / tick) * tick;
  info(`spot=${spot} tick=${tick} → strike=${strike}`);

  // ── Preview the mint cost via devInspect ──────────────────────────────────
  step(5, "Preview mint cost via predict::get_trade_amounts (devInspect)");
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
    const dryRun = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: previewTx,
    });
    const returns = dryRun.results?.[0]?.returnValues;
    if (returns?.length === 2) {
      const cost = readU64(returns[0]?.[0] ?? []);
      const payout = readU64(returns[1]?.[0] ?? []);
      info(
        `quantity=${PHASE0_DEFAULT_QUANTITY} → mint_cost=${cost} dUSDC raw, redeem_payout=${payout}`,
      );
    } else {
      warn(
        `devInspect ran but no return values decoded (status=${dryRun.effects.status.status})`,
      );
    }
  } catch (err) {
    warn(`devInspect failed (continuing): ${(err as Error).message}`);
  }

  // ── Mint ──────────────────────────────────────────────────────────────────
  step(6, "Deposit dUSDC into the manager and mint UP position");
  const mintTx = new Transaction();
  const dusdcCoins = await client.getCoins({
    owner: address,
    coinType: DUSDC_COIN_TYPE,
  });
  if (dusdcCoins.data.length === 0) {
    fail("no dUSDC coins to deposit");
    process.exitCode = 1;
    return;
  }
  const primary = dusdcCoins.data[0]!;
  if (dusdcCoins.data.length > 1) {
    mintTx.mergeCoins(
      mintTx.object(primary.coinObjectId),
      dusdcCoins.data.slice(1).map((c) => mintTx.object(c.coinObjectId)),
    );
  }
  const [deposit] = mintTx.splitCoins(mintTx.object(primary.coinObjectId), [
    mintTx.pure.u64(PHASE0_BUDGET_DUSDC_RAW),
  ]);
  addDepositDusdcCall(mintTx, { managerId, coinArg: deposit! });

  const mintKey = addMarketKeyUp(mintTx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(oracle.expiry),
    strike,
  });
  addMintCall(mintTx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg: mintKey,
    quantity: PHASE0_DEFAULT_QUANTITY,
  });

  const mintRes = await client.signAndExecuteTransaction({
    transaction: mintTx,
    signer: keypair,
    options: { showEvents: true, showEffects: true },
  });
  digest("mint", mintRes.digest);
  if (mintRes.effects?.status?.status !== "success") {
    fail(`mint failed: ${mintRes.effects?.status?.error}`);
    process.exitCode = 1;
    return;
  }
  ok("mint landed");

  // ── Wait for settlement ───────────────────────────────────────────────────
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
    fail("oracle did not settle within deadline");
    process.exitCode = 1;
    return;
  }
  const won = BigInt(settled.settlement_price!) > strike;
  ok(
    `settled at ${settled.settlement_price} vs strike ${strike} — UP position ${won ? "WINS" : "LOSES"}`,
  );

  // ── Redeem ────────────────────────────────────────────────────────────────
  step(8, "Redeem position via predict::redeem");
  const redeemTx = new Transaction();
  const redeemKey = addMarketKeyUp(redeemTx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(settled.expiry),
    strike,
  });
  addRedeemCall(redeemTx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg: redeemKey,
    quantity: PHASE0_DEFAULT_QUANTITY,
  });
  const redeemRes = await client.signAndExecuteTransaction({
    transaction: redeemTx,
    signer: keypair,
    options: { showEvents: true, showEffects: true },
  });
  digest("redeem", redeemRes.digest);
  if (redeemRes.effects?.status?.status !== "success") {
    fail(`redeem failed: ${redeemRes.effects?.status?.error}`);
    process.exitCode = 1;
    return;
  }
  ok("redeem landed");

  // ── Summary ───────────────────────────────────────────────────────────────
  heading("Phase 0 complete ✓");
  console.log(
    JSON.stringify(
      {
        address,
        manager_id: managerId,
        oracle_id: oracle.oracle_id,
        underlying: oracle.underlying_asset,
        strike: strike.toString(),
        quantity: PHASE0_DEFAULT_QUANTITY.toString(),
        settlement_price: settled.settlement_price,
        won,
        mint_digest: mintRes.digest,
        redeem_digest: redeemRes.digest,
      },
      null,
      2,
    ),
  );
}

function readU64(bytes: number[] | Uint8Array): string {
  const buf = Uint8Array.from(bytes);
  if (buf.length < 8) return "0";
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]!);
  return n.toString();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
