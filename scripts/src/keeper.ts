/*
 * Hunchbook vault keeper — the robot operator.
 *
 * Four isolated jobs per cycle:
 *   1. mark   — post the exact PLP price (pool vault_value / plp_supply) to the vault
 *   2. fees   — hourly accrue_fees (mgmt trickle + perf above watermark)
 *   3. buffer — keep idle within [25%, 60%] of NAV, rebalance toward 40%
 *   4. hedge  — redeem expired winning wings, keep one OTM DOWN wing alive
 *
 * Signs with the sui CLI keystore key (see lib/signer.ts). Run: pnpm keeper
 * Env: DRY_RUN=1 (no writes), CYCLE_MS, MARK_MIN_DELTA_BPS, HEDGE_MIN_BUDGET_USD…
 */
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  DUSDC_COIN_TYPE,
  SUI_CLOCK_OBJECT_ID,
  SUI_FULLNODE_URL,
  VAULT_ADMIN_CAP_ID,
  VAULT_MANAGER_ID,
  VAULT_MODULE,
  VAULT_OBJECT_ID,
  VAULT_PACKAGE_ID,
  PREDICT_OBJECT_ID,
  PREDICT_PACKAGE_ID,
  PREDICT_MODULE,
  addGetTradeAmountsCall,
  addMarketKeyDown,
  getOracleState,
  listOracles,
  pickRoundTripOracle,
} from "@hunchbook/shared";
import { loadActiveCliKeypair } from "./lib/signer";
import { fail, heading, info, ok, warn } from "./lib/log";

// ---------------------------------------------------------------- config
const env = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
const DRY_RUN = process.env.DRY_RUN === "1";
const CYCLE_MS = env("CYCLE_MS", 60_000);
const MARK_MIN_DELTA_BPS = env("MARK_MIN_DELTA_BPS", 2);
const ACCRUE_EVERY_MS = env("ACCRUE_EVERY_MS", 3_600_000);
const BUFFER_LOW_BPS = env("BUFFER_LOW_BPS", 2_500);
const BUFFER_TARGET_BPS = env("BUFFER_TARGET_BPS", 4_000);
const BUFFER_HIGH_BPS = env("BUFFER_HIGH_BPS", 6_000);
const HEDGE_MIN_BUDGET_USD = env("HEDGE_MIN_BUDGET_USD", 0.5);
const HEDGE_MIN_TTE_MS = env("HEDGE_MIN_TTE_MS", 10 * 60_000);
const HEDGE_MAX_TTE_MS = env("HEDGE_MAX_TTE_MS", 6 * 3_600_000);
const GAS_WARN_SUI = env("GAS_WARN_SUI", 0.05);

const Q64 = 1n << 64n;
const DUSDC = 1e6;
const MS_PER_YEAR = 365 * 24 * 3_600_000;
// Contract enforces ±20% per set_plp_mark; stay just inside it when stepping.
const MAX_STEP_BPS = 1_900n;

const VAULT_FN = (fn: string) => `${VAULT_PACKAGE_ID}::${VAULT_MODULE}::${fn}`;

// Mirror of hedge_policy::annual_hedge_bps — the contract is the source of truth.
function annualHedgeBps(utilizationBps: number): number {
  if (utilizationBps < 500) return 100;
  if (utilizationBps < 2_000) return 300;
  if (utilizationBps < 5_000) return 800;
  return 1_500;
}

// ---------------------------------------------------------------- chain state
interface PoolState {
  vaultValueRaw: bigint;
  plpSupplyRaw: bigint;
  utilizationBps: number;
}

interface VaultState {
  idleRaw: bigint;
  plpRaw: bigint;
  markQ64: bigint;
  deployedRaw: bigint;
  sharesRaw: bigint;
  paused: boolean;
  hedgeSigmaBps: number;
  navRaw: bigint;
}

async function readPool(client: SuiClient): Promise<PoolState> {
  const obj = await client.getObject({ id: PREDICT_OBJECT_ID, options: { showContent: true } });
  const c = obj.data?.content;
  if (c?.dataType !== "moveObject") throw new Error("predict object unreadable");
  const f = c.fields as unknown as {
    vault: { fields: { balance: string; total_mtm: string; total_max_payout: string } };
    treasury_cap: { fields: { total_supply: { fields: { value: string } } } };
  };
  const vaultValueRaw = BigInt(f.vault.fields.balance) - BigInt(f.vault.fields.total_mtm);
  return {
    vaultValueRaw,
    plpSupplyRaw: BigInt(f.treasury_cap.fields.total_supply.fields.value),
    utilizationBps:
      vaultValueRaw > 0n
        ? Number((BigInt(f.vault.fields.total_max_payout) * 10_000n) / vaultValueRaw)
        : 0,
  };
}

async function readVault(client: SuiClient): Promise<VaultState> {
  const obj = await client.getObject({ id: VAULT_OBJECT_ID, options: { showContent: true } });
  const c = obj.data?.content;
  if (c?.dataType !== "moveObject") throw new Error("vault object unreadable");
  const f = c.fields as unknown as {
    idle: string;
    plp_balance: string;
    plp_mark_q64: string;
    deployed_principal: string;
    paused: boolean;
    hedge_sigma_bps: number;
    treasury: { fields: { total_supply: { fields: { value: string } } } };
  };
  const idleRaw = BigInt(f.idle);
  const plpRaw = BigInt(f.plp_balance);
  const markQ64 = BigInt(f.plp_mark_q64);
  const deployedRaw = BigInt(f.deployed_principal);
  return {
    idleRaw,
    plpRaw,
    markQ64,
    deployedRaw,
    sharesRaw: BigInt(f.treasury.fields.total_supply.fields.value),
    paused: f.paused,
    hedgeSigmaBps: Number(f.hedge_sigma_bps),
    navRaw: idleRaw + deployedRaw + (plpRaw * markQ64) / Q64,
  };
}

// ---------------------------------------------------------------- execution
type Signer = ReturnType<typeof loadActiveCliKeypair>;

async function execute(
  client: SuiClient,
  signer: Signer,
  tx: Transaction,
  label: string,
): Promise<boolean> {
  if (DRY_RUN) {
    info(`[dry-run] would execute: ${label}`);
    return false;
  }
  tx.setSender(signer.address);
  const result = await client.signAndExecuteTransaction({
    signer: signer.keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: result.digest });
  const status = result.effects?.status;
  if (status?.status !== "success") {
    throw new Error(`${label} failed on-chain: ${status?.error ?? "unknown"}`);
  }
  ok(`${label} → ${result.digest}`);
  return true;
}

// ---------------------------------------------------------------- jobs
async function markJob(client: SuiClient, signer: Signer, pool: PoolState, vault: VaultState) {
  if (vault.plpRaw === 0n || pool.plpSupplyRaw === 0n) return;
  const target = (pool.vaultValueRaw * Q64) / pool.plpSupplyRaw;
  const current = vault.markQ64;
  if (current > 0n) {
    const diff = target > current ? target - current : current - target;
    const deltaBps = Number((diff * 10_000n) / current);
    if (deltaBps < MARK_MIN_DELTA_BPS) return; // unchanged — save the gas
  }
  // Respect the contract's drift bound: step toward far targets.
  let next = target;
  if (current > 0n) {
    const maxUp = current + (current * MAX_STEP_BPS) / 10_000n;
    const maxDown = current - (current * MAX_STEP_BPS) / 10_000n;
    if (next > maxUp) next = maxUp;
    if (next < maxDown) next = maxDown;
    if (next !== target) warn(`mark target beyond drift bound — stepping ${current} → ${next}`);
  }
  const tx = new Transaction();
  tx.moveCall({
    target: VAULT_FN("set_plp_mark"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(VAULT_OBJECT_ID),
      tx.object(VAULT_ADMIN_CAP_ID),
      tx.pure.u128(next),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  await execute(client, signer, tx, `set_plp_mark(${(Number(next) / Number(Q64)).toFixed(6)})`);
}

let lastAccrueMs = 0;
async function feesJob(client: SuiClient, signer: Signer, vault: VaultState) {
  if (vault.sharesRaw === 0n) return;
  if (Date.now() - lastAccrueMs < ACCRUE_EVERY_MS) return;
  const tx = new Transaction();
  tx.moveCall({
    target: VAULT_FN("accrue_fees"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(VAULT_OBJECT_ID),
      tx.object(VAULT_ADMIN_CAP_ID),
      tx.object(VAULT_MANAGER_ID),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  await execute(client, signer, tx, "accrue_fees");
  lastAccrueMs = Date.now();
}

async function bufferJob(client: SuiClient, signer: Signer, vault: VaultState) {
  if (vault.navRaw === 0n) return;
  const idleBps = Number((vault.idleRaw * 10_000n) / vault.navRaw);
  const targetIdle = (vault.navRaw * BigInt(BUFFER_TARGET_BPS)) / 10_000n;

  if (idleBps < BUFFER_LOW_BPS && vault.plpRaw > 0n && vault.markQ64 > 0n) {
    // Pull from the pool back to the target buffer.
    const needRaw = targetIdle - vault.idleRaw;
    let plpShares = (needRaw * Q64) / vault.markQ64;
    if (plpShares > vault.plpRaw) plpShares = vault.plpRaw;
    if (plpShares <= 0n) return;
    const tx = new Transaction();
    tx.moveCall({
      target: VAULT_FN("redeem_plp_to_idle"),
      typeArguments: [DUSDC_COIN_TYPE],
      arguments: [
        tx.object(VAULT_OBJECT_ID),
        tx.object(VAULT_ADMIN_CAP_ID),
        tx.object(PREDICT_OBJECT_ID),
        tx.pure.u64(plpShares),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await execute(client, signer, tx, `buffer refill: redeem ${Number(plpShares) / DUSDC} PLP`);
  } else if (idleBps > BUFFER_HIGH_BPS && !vault.paused) {
    // Put excess cash to work.
    const excessRaw = vault.idleRaw - targetIdle;
    if (excessRaw < BigInt(Math.round(0.1 * DUSDC))) return; // ignore dust
    const tx = new Transaction();
    tx.moveCall({
      target: VAULT_FN("supply_idle_to_plp"),
      typeArguments: [DUSDC_COIN_TYPE],
      arguments: [
        tx.object(VAULT_OBJECT_ID),
        tx.object(VAULT_ADMIN_CAP_ID),
        tx.object(PREDICT_OBJECT_ID),
        tx.pure.u64(excessRaw),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await execute(client, signer, tx, `buffer trim: supply ${Number(excessRaw) / DUSDC} dUSDC`);
  }
}

// -------------------------------------------------------- hedge job helpers
interface WingPosition {
  oracleId: string;
  expiry: number;
  strikeRaw: bigint;
  direction: 0 | 1; // 0 = UP, 1 = DOWN
  quantityRaw: bigint;
}

async function readManagerWings(client: SuiClient): Promise<WingPosition[]> {
  const managerObj = await client.getObject({
    id: VAULT_MANAGER_ID,
    options: { showContent: true },
  });
  const c = managerObj.data?.content;
  if (c?.dataType !== "moveObject") return [];
  const tableId = (
    c.fields as unknown as { positions: { fields: { id: { id: string } } } }
  ).positions.fields.id.id;

  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.getDynamicFields({ parentId: tableId, cursor: cursor ?? undefined });
    ids.push(...page.data.map((f) => f.objectId));
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor && ids.length < 100);
  if (ids.length === 0) return [];

  const objs = await client.multiGetObjects({ ids, options: { showContent: true } });
  const wings: WingPosition[] = [];
  for (const obj of objs) {
    const oc = obj.data?.content;
    if (oc?.dataType !== "moveObject") continue;
    const f = oc.fields as unknown as {
      name: { fields: { oracle_id: string; expiry: string; strike: string; direction: number } };
      value: string;
    };
    if (BigInt(f.value) === 0n) continue; // already redeemed stub
    wings.push({
      oracleId: f.name.fields.oracle_id,
      expiry: Number(f.name.fields.expiry),
      strikeRaw: BigInt(f.name.fields.strike),
      direction: f.name.fields.direction as 0 | 1,
      quantityRaw: BigInt(f.value),
    });
  }
  return wings;
}

function addWingKey(tx: Transaction, wing: { oracleId: string; expiry: number; strikeRaw: bigint }) {
  // Down wings only in v1 — crash insurance, per the hedge design.
  return addMarketKeyDown(tx, {
    oracleId: wing.oracleId,
    expiry: BigInt(wing.expiry),
    strike: wing.strikeRaw,
  });
}

async function hedgeJob(client: SuiClient, signer: Signer, pool: PoolState, vault: VaultState) {
  const now = Date.now();
  const oracles = await listOracles();
  const oraclesById = new Map(oracles.map((o) => [o.oracle_id, o]));
  const wings = await readManagerWings(client);

  // (a) redeem expired winning wings, then reclaim the proceeds to idle.
  for (const wing of wings.filter((w) => w.expiry <= now)) {
    const oracle = oraclesById.get(wing.oracleId);
    if (oracle?.status !== "settled" || oracle.settlement_price === null) continue;
    const settled = BigInt(Math.round(oracle.settlement_price)); // raw 1e9, same scale as strike
    const won = wing.direction === 1 ? settled < wing.strikeRaw : settled > wing.strikeRaw;
    if (!won) continue; // lost wings expire worthless — nothing to redeem
    const tx = new Transaction();
    const keyArg = addWingKey(tx, wing);
    tx.moveCall({
      target: VAULT_FN("redeem_hedge_wing"),
      typeArguments: [DUSDC_COIN_TYPE],
      arguments: [
        tx.object(VAULT_OBJECT_ID),
        tx.object(VAULT_ADMIN_CAP_ID),
        tx.object(PREDICT_OBJECT_ID),
        tx.object(VAULT_MANAGER_ID),
        tx.object(wing.oracleId),
        keyArg,
        tx.pure.u64(wing.quantityRaw),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await execute(
      client,
      signer,
      tx,
      `redeem winning wing ${Number(wing.quantityRaw) / DUSDC} units`,
    );
  }

  // (b) one live wing at a time.
  if (wings.some((w) => w.expiry > now)) return;

  const oracle = pickRoundTripOracle(oracles, {
    now,
    minMs: HEDGE_MIN_TTE_MS,
    maxMs: HEDGE_MAX_TTE_MS,
  });
  if (!oracle) {
    info("hedge: no oracle in the 10min–6h expiry window — will retry next cycle");
    return;
  }
  const state = await getOracleState(oracle.oracle_id);
  const spot = state.latest_price?.spot;
  if (!spot) return;

  // Budget: policy bps of NAV, scaled to this wing's lifetime; floored for testnet scale.
  const tteMs = oracle.expiry - now;
  const navUsd = Number(vault.navRaw) / DUSDC;
  const policyUsd = navUsd * (annualHedgeBps(pool.utilizationBps) / 10_000) * (tteMs / MS_PER_YEAR);
  const budgetUsd = Math.max(policyUsd, HEDGE_MIN_BUDGET_USD);
  if (Number(vault.idleRaw) / DUSDC < budgetUsd * 2) {
    warn("hedge: idle too thin to fund a wing — skipping");
    return;
  }

  // OTM DOWN strike: start sigma bps below spot and walk inward until the
  // protocol will actually price the wing — deep-OTM quotes abort upstream.
  // Indexer prices/ticks are already u64 × 1e9 raw — do NOT rescale.
  const spotRaw = BigInt(Math.round(spot));
  const tickRaw = BigInt(Math.round(oracle.tick_size));
  const minStrikeRaw = BigInt(Math.round(oracle.min_strike));

  // The pool only mints wings whose unit ask sits inside its configured
  // [min, max] band — a too-cheap deep-OTM wing aborts assert_mintable_ask.
  const boundsTx = new Transaction();
  boundsTx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::${PREDICT_MODULE}::ask_bounds`,
    arguments: [boundsTx.object(PREDICT_OBJECT_ID), boundsTx.pure.id(oracle.oracle_id)],
  });
  const boundsInspect = await client.devInspectTransactionBlock({
    sender: signer.address,
    transactionBlock: boundsTx,
  });
  const boundsRet = boundsInspect.results?.at(-1)?.returnValues;
  if (boundsInspect.error || !boundsRet?.[0] || !boundsRet[1]) {
    warn("hedge: ask_bounds unreadable — skipping");
    return;
  }
  const minAskRaw = BigInt(bcs.u64().parse(Uint8Array.from(boundsRet[0][0])));
  const maxAskRaw = BigInt(bcs.u64().parse(Uint8Array.from(boundsRet[1][0])));

  let strikeRaw = 0n;
  let askPerUnitRaw = 0n;
  for (const divisor of [1, 2, 4, 8]) {
    const otmBps = Math.max(Math.floor(vault.hedgeSigmaBps / divisor), 10);
    let candidate = ((spotRaw * BigInt(10_000 - otmBps)) / 10_000n / tickRaw) * tickRaw;
    if (candidate < minStrikeRaw) candidate = minStrikeRaw;

    const quoteTx = new Transaction();
    const quoteKey = addWingKey(quoteTx, {
      oracleId: oracle.oracle_id,
      expiry: oracle.expiry,
      strikeRaw: candidate,
    });
    addGetTradeAmountsCall(quoteTx, {
      oracleId: oracle.oracle_id,
      keyArg: quoteKey,
      quantity: 1_000_000n,
    });
    const inspect = await client.devInspectTransactionBlock({
      sender: signer.address,
      transactionBlock: quoteTx,
    });
    const ret = inspect.results?.at(-1)?.returnValues;
    if (!inspect.error && ret?.[0]) {
      const ask = BigInt(bcs.u64().parse(Uint8Array.from(ret[0][0])));
      // ask is per-unit dUSDC (1e6); bounds are price fractions (1e9) — align scales.
      const askScaled = ask * 1_000n;
      if (askScaled >= minAskRaw && askScaled <= maxAskRaw) {
        strikeRaw = candidate;
        askPerUnitRaw = ask;
        if (divisor > 1) info(`hedge: strike walked in to ${otmBps}bps OTM (ask ${Number(ask) / DUSDC}/unit)`);
        break;
      }
    }
  }
  if (askPerUnitRaw === 0n) {
    info("hedge: no strike with a mintable ask on this oracle — will retry next cycle");
    return;
  }
  const budgetRaw = BigInt(Math.round(budgetUsd * DUSDC));
  const quantityRaw = (budgetRaw * 1_000_000n) / askPerUnitRaw;
  if (quantityRaw < 1_000_000n) {
    info("hedge: budget buys < 1 unit at this ask — skipping");
    return;
  }

  // Atomic: fund the manager and mint the wing in one PTB (20% cost margin).
  const fundRaw = (budgetRaw * 120n) / 100n;
  const tx = new Transaction();
  tx.moveCall({
    target: VAULT_FN("deploy_idle"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(VAULT_OBJECT_ID),
      tx.object(VAULT_ADMIN_CAP_ID),
      tx.object(VAULT_MANAGER_ID),
      tx.pure.u64(fundRaw),
    ],
  });
  const keyArg = addWingKey(tx, { oracleId: oracle.oracle_id, expiry: oracle.expiry, strikeRaw });
  tx.moveCall({
    target: VAULT_FN("mint_hedge_wing"),
    typeArguments: [DUSDC_COIN_TYPE],
    arguments: [
      tx.object(VAULT_OBJECT_ID),
      tx.object(VAULT_ADMIN_CAP_ID),
      tx.object(PREDICT_OBJECT_ID),
      tx.object(VAULT_MANAGER_ID),
      tx.object(oracle.oracle_id),
      keyArg,
      tx.pure.u64(quantityRaw),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  await execute(
    client,
    signer,
    tx,
    `mint DOWN wing: ${Number(quantityRaw) / DUSDC} units @ strike ${Number(strikeRaw) / 1e9}`,
  );
}

// ---------------------------------------------------------------- main loop
async function cycle(client: SuiClient, signer: Signer, n: number) {
  const [pool, vault, gas] = await Promise.all([
    readPool(client),
    readVault(client),
    client.getBalance({ owner: signer.address }),
  ]);
  const gasSui = Number(gas.totalBalance) / 1e9;
  const price = vault.sharesRaw > 0n ? Number(vault.navRaw) / Number(vault.sharesRaw) : 1;
  const idlePct = vault.navRaw > 0n ? Number((vault.idleRaw * 100n) / vault.navRaw) : 0;
  info(
    `cycle ${n} | nav ${(Number(vault.navRaw) / DUSDC).toFixed(2)} | price ${price.toFixed(6)} | ` +
      `pool mark ${(Number((pool.vaultValueRaw * Q64) / pool.plpSupplyRaw) / Number(Q64)).toFixed(6)} | ` +
      `util ${pool.utilizationBps}bps | idle ${idlePct}% | gas ${gasSui.toFixed(3)} SUI`,
  );
  if (gasSui < GAS_WARN_SUI) {
    warn(`gas low (${gasSui.toFixed(3)} SUI) — top up at https://faucet.sui.io`);
  }

  const jobs: [string, () => Promise<void>][] = [
    ["mark", () => markJob(client, signer, pool, vault)],
    ["fees", () => feesJob(client, signer, vault)],
    ["buffer", () => bufferJob(client, signer, vault)],
    ["hedge", () => hedgeJob(client, signer, pool, vault)],
  ];
  for (const [name, run] of jobs) {
    try {
      await run();
    } catch (err) {
      fail(`${name} job: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const signer = loadActiveCliKeypair();
  const client = new SuiClient({ url: SUI_FULLNODE_URL });
  heading(
    `Hunchbook keeper — operator ${signer.address.slice(0, 8)}… ` +
      `vault ${VAULT_OBJECT_ID.slice(0, 8)}… ${DRY_RUN ? "(DRY RUN)" : ""}`,
  );
  info(`cycle ${CYCLE_MS / 1000}s | mark Δ≥${MARK_MIN_DELTA_BPS}bps | accrue ${ACCRUE_EVERY_MS / 60000}min`);

  let n = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    warn("SIGINT — finishing current cycle then exiting");
  });

  while (!stopping) {
    n += 1;
    try {
      await cycle(client, signer, n);
    } catch (err) {
      fail(`cycle ${n}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, CYCLE_MS));
  }
  ok("keeper stopped");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
