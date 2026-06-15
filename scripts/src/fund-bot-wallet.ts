/**
 * Send testnet SUI + dUSDC from the active CLI wallet to a bot wallet
 * (or any address). Auto-picks suitably-sized coins so you don't have
 * to hunt for object IDs.
 *
 * Run:
 *   BOT_WALLET=0x... pnpm fund-bot-wallet
 *
 * Defaults:
 *   - 0.1 SUI for gas
 *   - 10 dUSDC for betting
 *
 * Override with env vars:
 *   FUND_SUI_MIST=200000000     (0.2 SUI)
 *   FUND_DUSDC_RAW=50000000     (50 dUSDC)
 */
import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { DUSDC_COIN_TYPE, SUI_FULLNODE_URL } from "@hunchbook/shared";
import { digest, fail, heading, info, ok, step } from "./lib/log.js";
import { loadActiveCliKeypair } from "./lib/signer.js";

const DEST = process.env.BOT_WALLET;
const SUI_MIST = BigInt(process.env.FUND_SUI_MIST ?? "100000000"); // 0.1 SUI
const DUSDC_RAW = BigInt(process.env.FUND_DUSDC_RAW ?? "10000000"); // 10 dUSDC

const client = new SuiClient({
  transport: new SuiHTTPTransport({ url: SUI_FULLNODE_URL }),
});

async function main() {
  heading("Fund bot wallet from active CLI address");

  if (!DEST) {
    fail("BOT_WALLET env var not set. Example: BOT_WALLET=0x... pnpm fund-bot-wallet");
    process.exit(1);
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(DEST)) {
    fail(`BOT_WALLET '${DEST}' doesn't look like a Sui address (0x + 64 hex chars)`);
    process.exit(1);
  }

  step(0, "Load signer + read source balances");
  const { keypair, address } = loadActiveCliKeypair();
  ok(`source: ${address}`);
  ok(`dest:   ${DEST}`);
  info(`will send: ${SUI_MIST} MIST SUI + ${DUSDC_RAW} raw dUSDC`);

  step(1, "Build transfer PTB");
  const tx = new Transaction();

  // SUI: splitCoins from the gas coin (idiomatic — CLI does the same)
  const [suiOut] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI_MIST)]);

  // dUSDC: pick coins, merge if needed, split the requested amount
  const dusdcCoins = await client.getCoins({
    owner: address,
    coinType: DUSDC_COIN_TYPE,
  });
  if (dusdcCoins.data.length === 0) {
    fail("source has no dUSDC coins");
    process.exit(1);
  }
  const totalDusdc = dusdcCoins.data.reduce(
    (s, c) => s + BigInt(c.balance),
    0n,
  );
  if (totalDusdc < DUSDC_RAW) {
    fail(`source has ${totalDusdc} raw dUSDC, need ${DUSDC_RAW}`);
    process.exit(1);
  }
  const primary = dusdcCoins.data[0]!;
  if (dusdcCoins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      dusdcCoins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  const [dusdcOut] = tx.splitCoins(tx.object(primary.coinObjectId), [
    tx.pure.u64(DUSDC_RAW),
  ]);

  tx.transferObjects([suiOut!, dusdcOut!], tx.pure.address(DEST));

  step(2, "Sign and execute");
  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showBalanceChanges: true },
  });
  digest("fund", res.digest);
  if (res.effects?.status?.status !== "success") {
    fail(`tx failed: ${res.effects?.status?.error}`);
    process.exit(1);
  }
  ok("funded");

  step(3, "Verify destination balances");
  await client.waitForTransaction({ digest: res.digest });
  const [suiAfter, dusdcAfter] = await Promise.all([
    client.getBalance({ owner: DEST }),
    client.getBalance({ owner: DEST, coinType: DUSDC_COIN_TYPE }),
  ]);
  info(`dest SUI   : ${suiAfter.totalBalance}`);
  info(`dest dUSDC : ${dusdcAfter.totalBalance}`);

  heading("Done ✓");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
