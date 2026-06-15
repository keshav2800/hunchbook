/**
 * Hunchbook bot — entry point.
 *
 * Run with: pnpm bot:dev
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN          — from @BotFather
 *   HUNCHBOOK_BOT_MASTER_KEY  — base64 of 32 bytes (openssl rand -base64 32)
 *
 * UX model:
 *   - persistent reply keyboard at the bottom for nav (Markets/Positions/Balance/Export/Help/Close)
 *   - inline keyboards attached to data screens (UP/DOWN per market, Cash out per position)
 *   - ForceReply + in-memory pending-action map for multi-step flows (tap UP → "how much?" → type "2")
 */
import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  addCashoutCall,
  addDepositDusdcCall,
  addGetRangeTradeAmountsCall,
  addGetTradeAmountsCall,
  addMarketKeyDown,
  addMarketKeyUp,
  addMintRangeCall,
  addPlaceBetCall,
  addRangeKey,
  addRedeemCall,
  DUSDC_COIN_TYPE,
  FEE_BPS,
  FEE_RECIPIENT_ADDRESS,
  getOracleState,
  IndexerOracle,
  listOracles,
  PREDICT_INDEXER_URL,
  PREDICT_PACKAGE_ID,
  SUI_FULLNODE_URL,
} from "@hunchbook/shared";
import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { seal, unseal } from "./crypto.js";
import { openDb, type UserRow } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the bot package root (one level up from src/).
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const DB_PATH = process.env.BOT_DB_PATH
  ? resolve(process.env.BOT_DB_PATH)
  : resolve(__dirname, "..", "data", "hunchbook.db");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} is not set`);
    process.exit(1);
  }
  return v;
}

const TOKEN = requireEnv("TELEGRAM_BOT_TOKEN");
requireEnv("HUNCHBOOK_BOT_MASTER_KEY");

const db = openDb(DB_PATH);
const bot = new Bot(TOKEN);
const sui = new SuiClient({
  transport: new SuiHTTPTransport({ url: SUI_FULLNODE_URL }),
});

// ──────────────────────────────────────────────────────────────────────────
// Persistent reply keyboard (the bottom menu)
//
// Each button sends its label as a regular text message — bot.hears(...)
// catches them. `resized()` shrinks button height, `persistent()` makes the
// keyboard stay visible (no auto-hide on input). Mark the labels as
// constants so we route on them without typos.
// ──────────────────────────────────────────────────────────────────────────

const NAV = {
  positions:    "📈 Positions",
  search:       "🔍 Search",
  markets:      "📊 Markets",
  track:        "🔔 Track",
  wallets:      "💳 Wallets",
  autoTrade:    "🤖 Auto Trade",
  copyTrade:    "💰 Copy-Trade",
  aiMatch:      "🎯 AI Match",
  rewards:      "🎁 Rewards",
  limitOrders:  "📋 Limit Orders",
  web:          "🌐 Web",
  settings:     "⚙️ Settings",
  hub:          "🏠 Hub",
  docs:         "📚 Docs",
  help:         "💬 Help",
  close:        "❌ Close",
} as const;

const mainMenu = new Keyboard()
  .text(NAV.positions).text(NAV.search).row()
  .text(NAV.markets).text(NAV.track).row()
  .text(NAV.wallets).text(NAV.autoTrade).row()
  .text(NAV.copyTrade).text(NAV.aiMatch).row()
  .text(NAV.rewards).text(NAV.limitOrders).row()
  .text(NAV.web).text(NAV.settings).row()
  .text(NAV.hub).text(NAV.docs).row()
  .text(NAV.help).text(NAV.close).row()
  .resized()
  .persistent();

// ──────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────────────────────

function formatDusdc(raw: bigint | string): string {
  const n = typeof raw === "string" ? BigInt(raw) : raw;
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}

function formatSui(raw: bigint | string): string {
  const n = typeof raw === "string" ? BigInt(raw) : raw;
  const whole = n / 1_000_000_000n;
  const frac = n % 1_000_000_000n;
  return `${whole}.${frac.toString().padStart(9, "0").slice(0, 4)}`;
}

function formatTtl(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs > 0 ? ` ${rs}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatStrikeUsd(strike: bigint | number | string): string {
  return `$${(Number(strike) / 1e9).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function formatSpotUsd(spot: bigint | number | string): string {
  return `$${(Number(spot) / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format a raw dUSDC price (6-decimal) as a Polymarket-style cents value. */
function formatPriceCents(rawDusdc: bigint): string {
  // 1 unit of position quantity = 1_000_000 raw dUSDC max payout.
  // raw cost for qty=1_000_000 → divide by 10_000 to get cents.
  const cents = Number(rawDusdc) / 10_000;
  return `${cents.toFixed(1)}¢`;
}

/** Decode a little-endian u64 from devInspect return-value bytes. */
function readU64Le(bytes: number[] | Uint8Array): bigint {
  const buf = Uint8Array.from(bytes);
  if (buf.length < 8) return 0n;
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]!);
  return n;
}

// ──────────────────────────────────────────────────────────────────────────
// Vibe presets — strike-offset shortcuts so lazy users can bet in one tap.
//
// offsetPct is "how far the strike is shifted to FAVOR the user's chosen side".
//   Positive  → strike is *already winning* (deep in-the-money, high premium)
//   Zero      → at-the-money (50/50-ish, medium premium)
//   Negative  → strike requires further move (out-of-the-money, low premium)
//
// For UP, "favoring" means a LOWER strike (BTC must end above strike).
// For DOWN, "favoring" means a HIGHER strike (BTC must end below strike).
// strikeForVibe() handles the sign.
// ──────────────────────────────────────────────────────────────────────────

type Vibe = "safe" | "strong" | "stretch" | "moon";

const VIBES: Record<Vibe, { label: string; emoji: string; offsetPct: number }> = {
  safe:    { label: "SAFE",    emoji: "🛡", offsetPct: +0.015 }, // 1.5% ITM
  strong:  { label: "STRONG",  emoji: "💪", offsetPct: 0 },      // ATM
  stretch: { label: "STRETCH", emoji: "🚀", offsetPct: -0.015 }, // 1.5% OTM
  moon:    { label: "MOON",    emoji: "🎰", offsetPct: -0.035 }, // 3.5% OTM
};

const VIBE_ORDER: Vibe[] = ["safe", "strong", "stretch", "moon"];

function strikeForVibe(
  spot: bigint,
  tick: bigint,
  vibe: Vibe,
  side: "up" | "down",
): bigint {
  const sideDir = side === "up" ? -1 : +1;
  const offset = VIBES[vibe].offsetPct * sideDir;
  const rawStrike = Number(spot) * (1 + offset);
  return (BigInt(Math.floor(rawStrike)) / tick) * tick;
}

// ──────────────────────────────────────────────────────────────────────────
// Pending-action state machine (in-memory, 5-min TTL)
// ──────────────────────────────────────────────────────────────────────────

type PendingAction =
  | {
      kind: "awaiting_bet_amount";
      oracleId: string;
      side: "up" | "down";
      symbol: string;
      vibe: Vibe | "custom";
      strike: bigint;
      createdAt: number;
    }
  | {
      kind: "awaiting_range_band";
      oracleId: string;
      symbol: string;
      createdAt: number;
    }
  | {
      kind: "awaiting_range_amount";
      oracleId: string;
      symbol: string;
      lowerStrike: bigint;
      higherStrike: bigint;
      createdAt: number;
    }
  | {
      kind: "awaiting_custom_strike";
      oracleId: string;
      symbol: string;
      side: "up" | "down";
      createdAt: number;
    };

const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingActions = new Map<number, PendingAction>();

function setPending(telegramId: number, action: PendingAction) {
  pendingActions.set(telegramId, action);
}
function getPending(telegramId: number): PendingAction | undefined {
  const p = pendingActions.get(telegramId);
  if (!p) return undefined;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    pendingActions.delete(telegramId);
    return undefined;
  }
  return p;
}
function clearPending(telegramId: number) {
  pendingActions.delete(telegramId);
}

// ──────────────────────────────────────────────────────────────────────────
// Indexer data + helpers
// ──────────────────────────────────────────────────────────────────────────

interface MintEvent {
  digest: string;
  oracle_id: string;
  expiry: number;
  strike: number | string;
  is_up: boolean;
  quantity: number | string;
  cost: number | string;
}
interface RedeemEvent {
  oracle_id: string;
  expiry: number;
  strike: number | string;
  is_up: boolean;
  quantity: number | string;
}
interface ManagerPositionsResponse {
  minted: MintEvent[];
  redeemed: RedeemEvent[];
}

async function fetchManagerPositions(
  managerId: string,
): Promise<ManagerPositionsResponse> {
  const res = await fetch(
    `${PREDICT_INDEXER_URL}/managers/${managerId}/positions`,
  );
  if (!res.ok) {
    throw new Error(`indexer /positions returned ${res.status}`);
  }
  return (await res.json()) as ManagerPositionsResponse;
}

function deriveOpenPositions(
  data: ManagerPositionsResponse,
): (MintEvent & { remaining: bigint })[] {
  const key = (m: {
    oracle_id: string;
    expiry: number;
    strike: number | string;
    is_up: boolean;
  }) => `${m.oracle_id}|${m.expiry}|${m.strike}|${m.is_up ? "U" : "D"}`;

  const remaining = new Map<string, bigint>();
  for (const m of data.minted) {
    remaining.set(key(m), (remaining.get(key(m)) ?? 0n) + BigInt(m.quantity));
  }
  for (const r of data.redeemed) {
    remaining.set(key(r), (remaining.get(key(r)) ?? 0n) - BigInt(r.quantity));
  }

  const open: (MintEvent & { remaining: bigint })[] = [];
  const seen = new Set<string>();
  for (const m of [...data.minted].sort(
    (a, b) => Number(b.expiry) - Number(a.expiry),
  )) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.add(k);
    const rem = remaining.get(k) ?? 0n;
    if (rem > 0n) open.push({ ...m, remaining: rem });
  }
  return open;
}

// ──────────────────────────────────────────────────────────────────────────
// On-chain helpers
// ──────────────────────────────────────────────────────────────────────────

function loadUserKeypair(user: UserRow): Ed25519Keypair {
  const secretBytes = unseal({
    ciphertext: user.secret_key_enc,
    iv: user.iv,
    authTag: user.auth_tag,
  });
  const secret = new TextDecoder().decode(secretBytes);
  return Ed25519Keypair.fromSecretKey(secret);
}

async function ensureManager(
  telegramId: number,
  keypair: Ed25519Keypair,
): Promise<string> {
  const user = db.getUserByTelegramId(telegramId);
  if (user?.manager_id) return user.manager_id;

  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::create_manager`,
    arguments: [],
  });
  const res = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`create_manager failed: ${res.effects?.status?.error}`);
  }
  const created = res.objectChanges?.find(
    (c) =>
      c.type === "created" &&
      "objectType" in c &&
      c.objectType?.includes("::predict_manager::PredictManager"),
  );
  if (!created || !("objectId" in created)) {
    throw new Error("could not extract PredictManager id from tx response");
  }
  const managerId = created.objectId as string;
  db.setManagerId(telegramId, managerId);
  await sui.waitForTransaction({ digest: res.digest });
  return managerId;
}

// ──────────────────────────────────────────────────────────────────────────
// Inline keyboard builders
// ──────────────────────────────────────────────────────────────────────────

function assetEmoji(symbol: string): string {
  if (symbol === "BTC") return "🟠";
  if (symbol === "ETH") return "🔵";
  if (symbol === "SUI") return "🟦";
  return "🟢";
}

/**
 * Convert a raw dUSDC mint cost for qty=1_000_000 into a win-probability
 * percentage and a payout multiplier. Cost is what you pay per $1 of max
 * payout, so prob ≈ cost (in dollars) and payout = $1 / cost.
 */
function priceToProbAndPayout(rawCost: bigint): { probPct: number; payoutX: number } {
  const cents = Number(rawCost) / 10_000; // raw → cents (qty 1m → 1.00 max payout)
  const probPct = Math.max(1, Math.min(99, cents)); // clamp display 1–99
  const payoutX = cents > 0 ? 100 / cents : 0;
  return { probPct, payoutX };
}

const TIER_META: Record<Vibe, { icon: string; label: string }> = {
  safe:    { icon: "🎯", label: "Likely" },
  strong:  { icon: "⚖️", label: "Even" },
  stretch: { icon: "🌟", label: "Stretch" },
  moon:    { icon: "🚀", label: "Long shot" },
};

function positionsInlineKeyboard(
  open: (MintEvent & { remaining: bigint })[],
  oracleMap: Map<string, IndexerOracle>,
): InlineKeyboard | undefined {
  const kb = new InlineKeyboard();
  let hasAny = false;
  for (const p of open) {
    const oracle = oracleMap.get(p.oracle_id);
    if (oracle?.status === "settled" && oracle.settlement_price !== null) {
      const settled = BigInt(oracle.settlement_price);
      const strike = BigInt(p.strike);
      const won = p.is_up ? settled > strike : settled < strike;
      const id = p.digest.slice(0, 8);
      const label = won
        ? `💰 Cash out ${oracle.underlying_asset} (won)`
        : `🧹 Close ${oracle.underlying_asset} (lost)`;
      kb.text(label, `cashout:${id}`).row();
      hasAny = true;
    }
  }
  return hasAny ? kb : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// View renderers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compute UP-side probabilities/payouts for all 4 vibe tiers in one
 * devInspect. Returns one entry per VIBE_ORDER index, or undefined per slot
 * if the call failed.
 */
async function fetchTierPrices(
  oracle: IndexerOracle,
  spot: bigint,
): Promise<(bigint | undefined)[]> {
  const tx = new Transaction();
  const tick = BigInt(oracle.tick_size);
  const strikes = VIBE_ORDER.map((v) => strikeForVibe(spot, tick, v, "up"));

  strikes.forEach((strike) => {
    const key = addMarketKeyUp(tx, {
      oracleId: oracle.oracle_id,
      expiry: BigInt(oracle.expiry),
      strike,
    });
    addGetTradeAmountsCall(tx, {
      oracleId: oracle.oracle_id,
      keyArg: key,
      quantity: 1_000_000n,
    });
  });

  try {
    const dry = await sui.devInspectTransactionBlock({
      sender: "0x0000000000000000000000000000000000000000000000000000000000000001",
      transactionBlock: tx,
    });
    if (dry.effects.status.status !== "success") return strikes.map(() => undefined);
    return strikes.map((_, i) => {
      const getIdx = i * 2 + 1; // each tier pushes 2 commands (key, get_trade_amounts)
      const bytes = dry.results?.[getIdx]?.returnValues?.[0]?.[0];
      return bytes ? readU64Le(bytes) : undefined;
    });
  } catch (err) {
    console.error("tier price preview failed:", (err as Error).message);
    return strikes.map(() => undefined);
  }
}

async function renderMarkets(opts?: { asset?: string }): Promise<{
  text: string;
  inline?: InlineKeyboard;
}> {
  const all = await listOracles();
  const now = Date.now();
  const activeAll = all
    .filter((o) => o.status === "active" && o.expiry > now + 30_000)
    .sort((a, b) => a.expiry - b.expiry);

  if (activeAll.length === 0) {
    return { text: "No active markets right now. Try again in a minute." };
  }

  // All distinct assets currently live, sorted so BTC comes first if present.
  const assetsAvailable = Array.from(new Set(activeAll.map((o) => o.underlying_asset)))
    .sort((a, b) => (a === "BTC" ? -1 : b === "BTC" ? 1 : a.localeCompare(b)));

  const targetAsset = opts?.asset && assetsAvailable.includes(opts.asset)
    ? opts.asset
    : assetsAvailable[0]!;

  const oracle = activeAll.find((o) => o.underlying_asset === targetAsset)!;
  const prefix = oracle.oracle_id.slice(2, 18);

  const state = await getOracleState(oracle.oracle_id);
  const spotRaw = state.latest_price?.spot;
  if (!spotRaw) {
    return {
      text: `No live price for ${targetAsset} yet — try again in a few seconds.`,
    };
  }
  const spot = BigInt(spotRaw);
  const tierPrices = await fetchTierPrices(oracle, spot);

  const ttl = formatTtl(oracle.expiry - now);
  const expTime = new Date(oracle.expiry).toISOString().slice(11, 16);
  const emoji = assetEmoji(targetAsset);

  const lines: string[] = [
    `${emoji} *${targetAsset}*  ·  ${formatSpotUsd(spotRaw)}`,
    `_Expires in ${ttl} · ${expTime} UTC_`,
    "",
    "💡 Any strike from $50k+ in $1 steps — pick exactly what you want.",
    "",
    "*Quick bets — tap your risk level:*",
  ];

  const kb = new InlineKeyboard();
  VIBE_ORDER.forEach((vibe, i) => {
    const meta = TIER_META[vibe];
    const raw = tierPrices[i];
    let label: string;
    if (raw && raw > 0n) {
      const { probPct, payoutX } = priceToProbAndPayout(raw);
      label = `${meta.icon} ${meta.label}  ~${probPct.toFixed(0)}% · ${payoutX.toFixed(1)}×`;
    } else {
      label = `${meta.icon} ${meta.label}`;
    }
    kb.text(label, `vibe:${vibe}:${prefix}`).row();
  });

  kb.text("🎛 Strike Studio", `studio:${prefix}`)
    .text("📦 Range", `range:${prefix}`)
    .row();

  // Asset cycler: only show if there's more than one asset live
  if (assetsAvailable.length > 1) {
    const next = assetsAvailable[(assetsAvailable.indexOf(targetAsset) + 1) % assetsAvailable.length]!;
    kb.text(`🔄 Switch to ${next}`, `switch:${next}`)
      .text("❓ How it works", "how:works")
      .row();
  } else {
    kb.text("❓ How it works", "how:works").row();
  }

  return { text: lines.join("\n"), inline: kb };
}

async function renderPositions(
  telegramId: number,
): Promise<{ text: string; inline?: InlineKeyboard }> {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) return { text: "No wallet yet. Tap /start first." };
  if (!user.manager_id) {
    return {
      text: "No bets placed yet. Tap *📊 Markets* to see what's live.",
    };
  }

  const positions = await fetchManagerPositions(user.manager_id);
  const open = deriveOpenPositions(positions);
  if (open.length === 0) {
    return { text: "No open positions. Tap *📊 Markets* to place one." };
  }

  const oracles = await listOracles();
  const oracleMap = new Map(oracles.map((o) => [o.oracle_id, o]));

  const lines: string[] = ["📈 *Open positions*", ""];
  open.forEach((p, i) => {
    const oracle = oracleMap.get(p.oracle_id);
    const expiryMs = Number(p.expiry);
    const now = Date.now();
    const strikeDollars = formatStrikeUsd(p.strike);
    const qtyDusdc = formatDusdc(p.remaining);
    const premium = formatDusdc(BigInt(p.cost));
    const sideTxt = p.is_up ? "↑ UP" : "↓ DOWN";

    let status: string;
    if (oracle?.status === "settled" && oracle.settlement_price !== null) {
      const settlement = BigInt(oracle.settlement_price);
      const strike = BigInt(p.strike);
      const won = p.is_up ? settlement > strike : settlement < strike;
      const settleDollars = formatStrikeUsd(settlement);
      status = won
        ? `✅ *WON* — settled at ${settleDollars}`
        : `❌ *LOST* — settled at ${settleDollars}`;
    } else if (now >= expiryMs) {
      status = `⏳ Awaiting settlement...`;
    } else {
      status = `⏰ Settles in ${formatTtl(expiryMs - now)}`;
    }

    lines.push(
      `*${i + 1}. ${oracle?.underlying_asset ?? "?"} ${sideTxt}* @ ${strikeDollars}`,
    );
    lines.push(`   ${qtyDusdc} dUSDC · premium ${premium} dUSDC`);
    lines.push(`   ${status}`);
    lines.push("");
  });

  return {
    text: lines.join("\n"),
    inline: positionsInlineKeyboard(open, oracleMap),
  };
}

async function renderBalance(telegramId: number): Promise<string> {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) return "No wallet yet. Tap /start first.";
  const [sui_, dusdc] = await Promise.all([
    sui.getBalance({ owner: user.sui_address }),
    sui.getBalance({ owner: user.sui_address, coinType: DUSDC_COIN_TYPE }),
  ]);
  return [
    "💰 *Your wallet*",
    "",
    `Address: \`${user.sui_address}\``,
    "",
    `SUI    : ${formatSui(sui_.totalBalance)}`,
    `dUSDC  : ${formatDusdc(dusdc.totalBalance)}`,
    "",
    BigInt(dusdc.totalBalance) === 0n
      ? "_Fund this address with testnet dUSDC to start betting._"
      : "_Ready to bet — tap 📊 Markets._",
  ].join("\n");
}

function welcomeText(address: string, isNew: boolean): string {
  return [
    isNew ? "🎯 *Hunchbook wallet created*" : "👋 *Welcome back*",
    "",
    `Your address: \`${address}\``,
    "",
    "*What you can do:*",
    "📊 Markets — list open prediction markets (vibe, range, custom)",
    "📈 Positions — your open bets",
    "💰 Balance — your SUI + dUSDC",
    "🤖 Auto-pilot — set-and-forget recurring bets",
    "❓ Help — show commands",
    "",
    "_Tap any button below to get started. Slash commands also work._",
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Core operations
// ──────────────────────────────────────────────────────────────────────────

async function placeBetForUser(
  ctx: Context,
  telegramId: number,
  oracle: IndexerOracle,
  side: "up" | "down",
  amount: number,
  /** Optional explicit strike. If omitted, defaults to at-the-money. */
  strikeOverride?: bigint,
) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("No wallet. Tap /start first.");
    return;
  }

  const quantity = BigInt(Math.floor(amount * 1_000_000));
  const payment = quantity;

  let strike = strikeOverride;
  if (strike === undefined) {
    const state = await getOracleState(oracle.oracle_id);
    const spot = state.latest_price?.spot ?? 0;
    if (!spot) {
      await ctx.reply("Oracle has no spot price right now. Try again in a few seconds.");
      return;
    }
    const tick = BigInt(oracle.tick_size);
    strike = (BigInt(spot) / tick) * tick;
  }

  const dusdcBal = await sui.getBalance({
    owner: user.sui_address,
    coinType: DUSDC_COIN_TYPE,
  });
  if (BigInt(dusdcBal.totalBalance) < payment) {
    await ctx.reply(
      `❌ Not enough dUSDC. You have ${formatDusdc(dusdcBal.totalBalance)}, need ${formatDusdc(payment)}.`,
    );
    return;
  }

  const keypair = loadUserKeypair(user);
  const strikeDollars = formatStrikeUsd(strike);
  const ttlSec = Math.round((oracle.expiry - Date.now()) / 1000);

  await ctx.reply(
    [
      `⏳ Submitting bet...`,
      ``,
      `*${oracle.underlying_asset} ${side.toUpperCase()}* @ ${strikeDollars}`,
      `Settles in ~${ttlSec}s`,
    ].join("\n"),
    { parse_mode: "Markdown" },
  );

  const managerId = await ensureManager(telegramId, keypair);

  const tx = new Transaction();
  const dusdcCoins = await sui.getCoins({
    owner: user.sui_address,
    coinType: DUSDC_COIN_TYPE,
  });
  const primary = dusdcCoins.data[0]!;
  if (dusdcCoins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      dusdcCoins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  const [paymentCoin] = tx.splitCoins(tx.object(primary.coinObjectId), [
    tx.pure.u64(payment),
  ]);
  const keyArg =
    side === "up"
      ? addMarketKeyUp(tx, {
          oracleId: oracle.oracle_id,
          expiry: BigInt(oracle.expiry),
          strike,
        })
      : addMarketKeyDown(tx, {
          oracleId: oracle.oracle_id,
          expiry: BigInt(oracle.expiry),
          strike,
        });
  addPlaceBetCall(tx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg,
    quantity,
    paymentCoin: paymentCoin!,
  });

  const res = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEvents: true, showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    await ctx.reply(`❌ Bet failed: ${res.effects?.status?.error}`);
    return;
  }

  const mintEv = res.events?.find((e) =>
    e.type.endsWith("::predict::PositionMinted"),
  );
  const premiumRaw = (mintEv?.parsedJson as { cost?: string } | undefined)?.cost;
  const entryFee = (payment * FEE_BPS) / 10_000n;
  const expiryDate = new Date(oracle.expiry);

  await ctx.reply(
    [
      `✅ *Bet placed*`,
      ``,
      `${oracle.underlying_asset} *${side.toUpperCase()}* @ strike ${strikeDollars}`,
      `Max payout if you win: ${amount} dUSDC`,
      ``,
      `Premium charged: ${premiumRaw ? formatDusdc(premiumRaw) : "?"} dUSDC`,
      `Entry fee (1%): ${formatDusdc(entryFee)} dUSDC`,
      `Expires: ${expiryDate.toISOString().replace("T", " ").slice(0, 19)} UTC`,
      ``,
      `[View tx ↗](https://suiscan.xyz/testnet/tx/${res.digest})`,
    ].join("\n"),
    {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    },
  );
}

/**
 * Range bets: predict::mint_range pays $1·qty if BTC settles in (lower, higher].
 * The router doesn't have a range_bet entry (yet), so we inline the 1% fee
 * split: transfer fee to treasury, deposit remainder, call mint_range.
 */
async function placeRangeBetForUser(
  ctx: Context,
  telegramId: number,
  oracle: IndexerOracle,
  lowerStrike: bigint,
  higherStrike: bigint,
  amount: number,
) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("No wallet. Tap /start first.");
    return;
  }

  const quantity = BigInt(Math.floor(amount * 1_000_000));
  const payment = quantity;
  const dusdcBal = await sui.getBalance({
    owner: user.sui_address,
    coinType: DUSDC_COIN_TYPE,
  });
  if (BigInt(dusdcBal.totalBalance) < payment) {
    await ctx.reply(
      `❌ Not enough dUSDC. You have ${formatDusdc(dusdcBal.totalBalance)}, need ${formatDusdc(payment)}.`,
    );
    return;
  }

  const keypair = loadUserKeypair(user);
  const ttlSec = Math.round((oracle.expiry - Date.now()) / 1000);
  await ctx.reply(
    [
      `⏳ Submitting range bet...`,
      ``,
      `📦 *${oracle.underlying_asset}* between *${formatStrikeUsd(lowerStrike)} and ${formatStrikeUsd(higherStrike)}*`,
      `Settles in ~${ttlSec}s`,
    ].join("\n"),
    { parse_mode: "Markdown" },
  );

  const managerId = await ensureManager(telegramId, keypair);

  const tx = new Transaction();
  const dusdcCoins = await sui.getCoins({
    owner: user.sui_address,
    coinType: DUSDC_COIN_TYPE,
  });
  const primary = dusdcCoins.data[0]!;
  if (dusdcCoins.data.length > 1) {
    tx.mergeCoins(
      tx.object(primary.coinObjectId),
      dusdcCoins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  // Split total payment off the user's primary coin
  const [paymentCoin] = tx.splitCoins(tx.object(primary.coinObjectId), [
    tx.pure.u64(payment),
  ]);
  // Skim 1% fee → treasury
  const feeAmount = (payment * FEE_BPS) / 10_000n;
  if (feeAmount > 0n) {
    const [feeCoin] = tx.splitCoins(paymentCoin!, [tx.pure.u64(feeAmount)]);
    tx.transferObjects([feeCoin!], tx.pure.address(FEE_RECIPIENT_ADDRESS));
  }
  // Deposit the rest into the manager
  addDepositDusdcCall(tx, { managerId, coinArg: paymentCoin! });
  // Build range key + mint_range — pulls premium from manager balance
  const keyArg = addRangeKey(tx, {
    oracleId: oracle.oracle_id,
    expiry: BigInt(oracle.expiry),
    lowerStrike,
    higherStrike,
  });
  addMintRangeCall(tx, {
    managerId,
    oracleId: oracle.oracle_id,
    keyArg,
    quantity,
  });

  const res = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEvents: true, showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    await ctx.reply(`❌ Range bet failed: ${res.effects?.status?.error}`);
    return;
  }

  const rangeEv = res.events?.find((e) =>
    e.type.endsWith("::predict::RangeMinted"),
  );
  const premiumRaw = (rangeEv?.parsedJson as { cost?: string } | undefined)?.cost;
  const expiryDate = new Date(oracle.expiry);

  await ctx.reply(
    [
      `✅ *Range bet placed*`,
      ``,
      `📦 ${oracle.underlying_asset} between *${formatStrikeUsd(lowerStrike)} and ${formatStrikeUsd(higherStrike)}*`,
      `Max payout if you win: ${amount} dUSDC`,
      ``,
      `Premium charged: ${premiumRaw ? formatDusdc(premiumRaw) : "?"} dUSDC`,
      `Entry fee (1%): ${formatDusdc(feeAmount)} dUSDC`,
      `Expires: ${expiryDate.toISOString().replace("T", " ").slice(0, 19)} UTC`,
      ``,
      `[View tx ↗](https://suiscan.xyz/testnet/tx/${res.digest})`,
    ].join("\n"),
    {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    },
  );
}

async function cashoutPositionForUser(
  ctx: Context,
  telegramId: number,
  positionIdPrefix: string,
) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user || !user.manager_id) {
    await ctx.reply("No positions to cash out.");
    return;
  }

  const positions = await fetchManagerPositions(user.manager_id);
  const open = deriveOpenPositions(positions);
  const match = open.find((p) => p.digest.startsWith(positionIdPrefix));
  if (!match) {
    await ctx.reply(`No open position matching id \`${positionIdPrefix}\`.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  const oracles = await listOracles();
  const oracle = oracles.find((o) => o.oracle_id === match.oracle_id);
  if (!oracle) {
    await ctx.reply("Oracle not found in indexer. Try again in a few seconds.");
    return;
  }
  if (oracle.status !== "settled" || oracle.settlement_price === null) {
    const ttl =
      oracle.expiry > Date.now()
        ? `expires in ${formatTtl(oracle.expiry - Date.now())}`
        : "expired, settlement posting soon";
    await ctx.reply(`Not settled yet (${ttl}). Try again once oracle settles.`);
    return;
  }

  const settlement = BigInt(oracle.settlement_price);
  const strike = BigInt(match.strike);
  const won = match.is_up ? settlement > strike : settlement < strike;
  const quantity = BigInt(match.remaining);
  const keypair = loadUserKeypair(user);

  await ctx.reply("⏳ Settling on testnet...");

  const tx = new Transaction();
  const keyArg = match.is_up
    ? addMarketKeyUp(tx, {
        oracleId: match.oracle_id,
        expiry: BigInt(match.expiry),
        strike,
      })
    : addMarketKeyDown(tx, {
        oracleId: match.oracle_id,
        expiry: BigInt(match.expiry),
        strike,
      });

  if (won) {
    addCashoutCall(tx, {
      managerId: user.manager_id,
      oracleId: match.oracle_id,
      keyArg,
      quantity,
      withdrawAmount: quantity,
    });
  } else {
    addRedeemCall(tx, {
      managerId: user.manager_id,
      oracleId: match.oracle_id,
      keyArg,
      quantity,
    });
  }

  const res = await sui.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEvents: true, showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    await ctx.reply(`❌ Cashout failed: ${res.effects?.status?.error}`);
    return;
  }
  await sui.waitForTransaction({ digest: res.digest });

  if (won) {
    const exitFee = (quantity * FEE_BPS) / 10_000n;
    const net = quantity - exitFee;
    await ctx.reply(
      [
        "✅ *Cashout complete — you won!*",
        "",
        `Payout: ${formatDusdc(quantity)} dUSDC`,
        `Exit fee (1%): ${formatDusdc(exitFee)} dUSDC`,
        `*You received: ${formatDusdc(net)} dUSDC*`,
        "",
        `[View tx ↗](https://suiscan.xyz/testnet/tx/${res.digest})`,
      ].join("\n"),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  } else {
    await ctx.reply(
      [
        "💔 *Position closed — better luck next time*",
        "",
        `Premium of ${formatDusdc(BigInt(match.cost))} dUSDC was the cost of the bet.`,
        "",
        `[View tx ↗](https://suiscan.xyz/testnet/tx/${res.digest})`,
      ].join("\n"),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Top-level screen routers (called by both /commands and reply-keyboard taps)
// ──────────────────────────────────────────────────────────────────────────

async function sendMarkets(ctx: Context, asset?: string) {
  try {
    const { text, inline } = await renderMarkets({ asset });
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: inline ?? mainMenu,
    });
  } catch (err) {
    await ctx.reply(`Failed to fetch markets: ${(err as Error).message}`);
  }
}

async function editToMarkets(ctx: Context, asset?: string) {
  try {
    const { text, inline } = await renderMarkets({ asset });
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: inline,
      });
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: inline });
    }
  } catch (err) {
    await ctx.reply(`Failed to refresh markets: ${(err as Error).message}`);
  }
}

async function sendPositions(ctx: Context, telegramId: number) {
  try {
    const { text, inline } = await renderPositions(telegramId);
    await ctx.reply(text, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
      reply_markup: inline ?? mainMenu,
    });
  } catch (err) {
    await ctx.reply(`Failed to load positions: ${(err as Error).message}`);
  }
}

async function sendBalance(ctx: Context, telegramId: number) {
  try {
    const text = await renderBalance(telegramId);
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Failed to fetch balance: ${(err as Error).message}`);
  }
}

async function sendHelp(ctx: Context) {
  await ctx.reply(
    [
      "*Hunchbook*",
      "",
      "Bet on BTC/ETH price moves on Sui testnet. Each bet is a contract that pays out 1 dUSDC per unit if you win.",
      "",
      "*Buttons:*",
      "📊 Markets — live prediction markets",
      "📈 Positions — your open bets",
      "💰 Balance — your wallet",
      "📤 Export — recovery phrase for self-custody",
      "",
      "*Slash commands (power users):*",
      "/bet btc up 2 — bet 2 dUSDC on BTC going up",
      "/cashout <id> — settle a position",
      "/cancel — abort a pending action",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Command handlers
// ──────────────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existing = db.getUserByTelegramId(telegramId);
  if (existing) {
    await ctx.reply(welcomeText(existing.sui_address, false), {
      parse_mode: "Markdown",
      reply_markup: mainMenu,
    });
    return;
  }

  const keypair = Ed25519Keypair.generate();
  const address = keypair.getPublicKey().toSuiAddress();
  const sealed = seal(new TextEncoder().encode(keypair.getSecretKey()));
  db.insertUser(telegramId, address, sealed.ciphertext, sealed.iv, sealed.authTag);

  await ctx.reply(welcomeText(address, true), {
    parse_mode: "Markdown",
    reply_markup: mainMenu,
  });
});

bot.command("markets", (ctx) => sendMarkets(ctx));
bot.command("balance", async (ctx) => {
  if (ctx.from?.id) await sendBalance(ctx, ctx.from.id);
});
bot.command("positions", async (ctx) => {
  if (ctx.from?.id) await sendPositions(ctx, ctx.from.id);
});
bot.command("help", (ctx) => sendHelp(ctx));

bot.command("bet", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const user = db.getUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("No wallet yet. Tap /start first.");
    return;
  }

  const args = (ctx.match || "").trim().split(/\s+/);
  if (args.length !== 3 || !args[0]) {
    await ctx.reply(
      "Usage: `/bet <symbol> <up|down> <amount>`\nOr just tap a market button.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const symbol = args[0]!.toUpperCase();
  const side = args[1]!.toLowerCase() as "up" | "down";
  if (side !== "up" && side !== "down") {
    await ctx.reply("Side must be `up` or `down`.");
    return;
  }
  const amount = Number(args[2]);
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("Amount must be a positive number.");
    return;
  }

  try {
    const oracles = await listOracles();
    const oracle = oracles
      .filter(
        (o) =>
          o.status === "active" &&
          o.underlying_asset === symbol &&
          o.expiry > Date.now() + 30_000,
      )
      .sort((a, b) => a.expiry - b.expiry)[0];
    if (!oracle) {
      await ctx.reply(`No active ${symbol} market in the next 30 minutes.`);
      return;
    }
    await placeBetForUser(ctx, telegramId, oracle, side, amount);
  } catch (err) {
    await ctx.reply(`❌ Error: ${(err as Error).message}`);
  }
});

bot.command("cashout", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const idArg = (ctx.match || "").trim();
  if (!idArg) {
    await ctx.reply(
      "Usage: `/cashout <id>` — or just tap a position button.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  try {
    await cashoutPositionForUser(ctx, telegramId, idArg);
  } catch (err) {
    await ctx.reply(`❌ Error: ${(err as Error).message}`);
  }
});

bot.command("cancel", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  if (getPending(telegramId)) {
    clearPending(telegramId);
    await ctx.reply("Cancelled.");
  } else {
    await ctx.reply("Nothing to cancel.");
  }
});

// ─── Auto-pilot ──────────────────────────────────────────────────────────
// /autopilot                                       → show status
// /autopilot start <vibe> <up|down> <$amt> <minInterval> <$budget>  → enable
// /autopilot stop                                  → disable
//
// Background runner ticks every 60s, fires due autopilots.

const VALID_VIBES_STR = ["safe", "strong", "stretch", "moon"];

function describeAutopilot(ap: import("./db.js").AutopilotRow): string {
  const dollars = (raw: number) =>
    (raw / 1_000_000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const intervalMin = Math.round(ap.interval_ms / 60_000);
  const lastRun = ap.last_run_at
    ? new Date(ap.last_run_at).toISOString().slice(11, 19) + " UTC"
    : "never";
  return [
    `${ap.active ? "🟢" : "🔴"} *Auto-pilot ${ap.active ? "ON" : "OFF"}*`,
    ``,
    `Vibe: ${ap.vibe.toUpperCase()} · Side: ${ap.side.toUpperCase()}`,
    `Asset: ${ap.asset}`,
    `Amount per bet: $${dollars(ap.amount_raw)}`,
    `Every: ${intervalMin} min`,
    `Budget: $${dollars(ap.budget_raw)} (spent $${dollars(ap.spent_raw)})`,
    `Last run: ${lastRun}`,
  ].join("\n");
}

bot.command("autopilot", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

  // /autopilot → show status
  if (args.length === 0) {
    const existing = db.getAutopilot(telegramId);
    if (!existing) {
      await ctx.reply(
        [
          "🤖 *Auto-pilot — not configured*",
          "",
          "Auto-pilot bets for you on a schedule. Set and forget.",
          "",
          "*Usage:*",
          "`/autopilot start <vibe> <up|down> <$amt> <minInterval> <$budget>`",
          "",
          "*Example:*",
          "`/autopilot start strong up 1 30 10`",
          "→ bet $1 on STRONG UP, every 30 min, up to $10 total",
          "",
          "Stop anytime with `/autopilot stop`.",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }
    await ctx.reply(describeAutopilot(existing), { parse_mode: "Markdown" });
    return;
  }

  if (args[0] === "stop") {
    const existing = db.getAutopilot(telegramId);
    if (!existing) {
      await ctx.reply("No auto-pilot configured.");
      return;
    }
    db.setAutopilotActive(telegramId, false);
    await ctx.reply("🔴 Auto-pilot stopped.");
    return;
  }

  if (args[0] !== "start" || args.length !== 6) {
    await ctx.reply(
      "Usage: `/autopilot start <vibe> <up|down> <$amt> <minInterval> <$budget>`",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const [, vibe, side, amtStr, intervalStr, budgetStr] = args;
  if (!VALID_VIBES_STR.includes(vibe!)) {
    await ctx.reply(`Vibe must be one of: ${VALID_VIBES_STR.join(", ")}`);
    return;
  }
  if (side !== "up" && side !== "down") {
    await ctx.reply("Side must be `up` or `down`.");
    return;
  }
  const amount = Number(amtStr);
  const intervalMin = Number(intervalStr);
  const budget = Number(budgetStr);
  if (![amount, intervalMin, budget].every((n) => Number.isFinite(n) && n > 0)) {
    await ctx.reply("Amount, interval, and budget must be positive numbers.");
    return;
  }
  if (intervalMin < 1) {
    await ctx.reply("Interval must be at least 1 minute.");
    return;
  }

  db.upsertAutopilot({
    telegram_id: telegramId,
    vibe: vibe!,
    side,
    amount_raw: Math.floor(amount * 1_000_000),
    asset: "BTC",
    interval_ms: intervalMin * 60_000,
    budget_raw: Math.floor(budget * 1_000_000),
  });

  await ctx.reply(
    [
      `🟢 *Auto-pilot started*`,
      ``,
      `Vibe: ${vibe!.toUpperCase()} · Side: ${side.toUpperCase()}`,
      `Bet $${amount} on BTC every ${intervalMin} min, up to $${budget} total`,
      ``,
      `Bot will fire bets automatically. You'll get a notification each time.`,
      `Stop with \`/autopilot stop\`.`,
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Reply-keyboard handlers (the persistent bottom menu)
// ──────────────────────────────────────────────────────────────────────────

bot.hears(NAV.markets, (ctx) => sendMarkets(ctx));
bot.hears(NAV.positions, async (ctx) => {
  if (ctx.from?.id) await sendPositions(ctx, ctx.from.id);
});
bot.hears(NAV.wallets, async (ctx) => {
  if (ctx.from?.id) await sendBalance(ctx, ctx.from.id);
});
bot.hears(NAV.help, (ctx) => sendHelp(ctx));
bot.hears(NAV.close, async (ctx) => {
  await ctx.reply("Menu closed. Send any message or /start to reopen.", {
    reply_markup: { remove_keyboard: true },
  });
});
bot.hears(NAV.autoTrade, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const existing = db.getAutopilot(telegramId);
  if (!existing) {
    await ctx.reply(
      [
        "🤖 *Auto-pilot — not configured*",
        "",
        "Set up recurring auto-bets:",
        "`/autopilot start <vibe> <up|down> <$amt> <minInterval> <$budget>`",
        "",
        "Example: `/autopilot start strong up 1 30 10`",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.reply(describeAutopilot(existing), { parse_mode: "Markdown" });
});

// ──────────────────────────────────────────────────────────────────────────
// Inline-button callback handlers
// ──────────────────────────────────────────────────────────────────────────

// Step 1: user tapped a vibe button → show UP/DOWN options at that vibe's strike
bot.callbackQuery(/^vibe:(safe|strong|stretch|moon):([a-f0-9]+)$/, async (ctx) => {
  const vibe = ctx.match[1] as Vibe;
  const prefix = ctx.match[2]!;
  try {
    const oracles = await listOracles();
    const oracle = oracles.find((o) => o.oracle_id.slice(2).startsWith(prefix));
    if (!oracle) {
      await ctx.answerCallbackQuery({ text: "Market no longer active." });
      return;
    }
    if (oracle.status !== "active" || oracle.expiry <= Date.now() + 30_000) {
      await ctx.answerCallbackQuery({ text: "Market expired — refresh markets." });
      return;
    }

    const state = await getOracleState(oracle.oracle_id);
    const spot = state.latest_price?.spot ?? 0;
    if (!spot) {
      await ctx.answerCallbackQuery({ text: "No spot yet — retry." });
      return;
    }
    const tick = BigInt(oracle.tick_size);
    const upStrike = strikeForVibe(BigInt(spot), tick, vibe, "up");
    const downStrike = strikeForVibe(BigInt(spot), tick, vibe, "down");

    // Fetch prices at the two chosen strikes in one PTB
    const previewTx = new Transaction();
    const upKey = addMarketKeyUp(previewTx, {
      oracleId: oracle.oracle_id,
      expiry: BigInt(oracle.expiry),
      strike: upStrike,
    });
    addGetTradeAmountsCall(previewTx, {
      oracleId: oracle.oracle_id,
      keyArg: upKey,
      quantity: 1_000_000n,
    });
    const downKey = addMarketKeyDown(previewTx, {
      oracleId: oracle.oracle_id,
      expiry: BigInt(oracle.expiry),
      strike: downStrike,
    });
    addGetTradeAmountsCall(previewTx, {
      oracleId: oracle.oracle_id,
      keyArg: downKey,
      quantity: 1_000_000n,
    });

    let upPrice: bigint | undefined;
    let downPrice: bigint | undefined;
    try {
      const dry = await sui.devInspectTransactionBlock({
        sender: "0x0000000000000000000000000000000000000000000000000000000000000001",
        transactionBlock: previewTx,
      });
      if (dry.effects.status.status === "success") {
        const upBytes = dry.results?.[1]?.returnValues?.[0]?.[0];
        const downBytes = dry.results?.[3]?.returnValues?.[0]?.[0];
        if (upBytes) upPrice = readU64Le(upBytes);
        if (downBytes) downPrice = readU64Le(downBytes);
      }
    } catch (err) {
      console.error("vibe price preview failed:", (err as Error).message);
    }

    const v = VIBES[vibe];
    const emoji = assetEmoji(oracle.underlying_asset);
    const ttl = formatTtl(oracle.expiry - Date.now());

    const kb = new InlineKeyboard()
      .text(
        upPrice
          ? `↑ UP @ ${formatStrikeUsd(upStrike)}  ${formatPriceCents(upPrice)}`
          : `↑ UP @ ${formatStrikeUsd(upStrike)}`,
        `bet:${vibe}:up:${prefix}`,
      )
      .row()
      .text(
        downPrice
          ? `↓ DOWN @ ${formatStrikeUsd(downStrike)}  ${formatPriceCents(downPrice)}`
          : `↓ DOWN @ ${formatStrikeUsd(downStrike)}`,
        `bet:${vibe}:down:${prefix}`,
      )
      .row()
      .text("← Back to markets", "ui:markets");

    await ctx.reply(
      [
        `${v.emoji} *${v.label}* on ${emoji} *${oracle.underlying_asset}*`,
        `Settles in ${ttl}`,
        `Live spot: *${formatSpotUsd(spot)}*`,
        ``,
        `Pick your side:`,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );
    await ctx.answerCallbackQuery();
  } catch (err) {
    await ctx.answerCallbackQuery({ text: (err as Error).message });
  }
});

// Step 2: user tapped UP or DOWN at a chosen vibe — store strike, ask for amount
bot.callbackQuery(/^bet:(safe|strong|stretch|moon):(up|down):([a-f0-9]+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const vibe = ctx.match[1] as Vibe;
  const side = ctx.match[2] as "up" | "down";
  const prefix = ctx.match[3]!;

  try {
    const oracles = await listOracles();
    const oracle = oracles.find((o) => o.oracle_id.slice(2).startsWith(prefix));
    if (!oracle) {
      await ctx.answerCallbackQuery({ text: "Market no longer active." });
      return;
    }
    if (oracle.status !== "active" || oracle.expiry <= Date.now() + 30_000) {
      await ctx.answerCallbackQuery({ text: "Market expired." });
      return;
    }
    const state = await getOracleState(oracle.oracle_id);
    const spot = state.latest_price?.spot ?? 0;
    if (!spot) {
      await ctx.answerCallbackQuery({ text: "No spot yet — retry." });
      return;
    }
    const tick = BigInt(oracle.tick_size);
    const strike = strikeForVibe(BigInt(spot), tick, vibe, side);

    setPending(telegramId, {
      kind: "awaiting_bet_amount",
      oracleId: oracle.oracle_id,
      side,
      symbol: oracle.underlying_asset,
      vibe,
      strike,
      createdAt: Date.now(),
    });

    const v = VIBES[vibe];
    const arrow = side === "up" ? "↑" : "↓";
    const direction = side === "up" ? "above" : "below";
    const ttl = formatTtl(oracle.expiry - Date.now());

    await ctx.reply(
      [
        `${v.emoji} *${v.label}* — ${oracle.underlying_asset} ${arrow} ${side.toUpperCase()}`,
        `Strike: *${formatStrikeUsd(strike)}*`,
        `Settles in ${ttl}`,
        ``,
        `Wins if ${oracle.underlying_asset} ends *${direction}* ${formatStrikeUsd(strike)}.`,
        ``,
        `*How much do you want to bet?*`,
        `Reply with $ of max payout (e.g. \`1\`, \`5\`, \`10\`).`,
        ``,
        `_Send /cancel to abort._`,
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: { force_reply: true, selective: true },
      },
    );
    await ctx.answerCallbackQuery();
  } catch (err) {
    await ctx.answerCallbackQuery({ text: (err as Error).message });
  }
});

// ─── Range Mode ──────────────────────────────────────────────────────────
// User taps "📦 Range" → bot asks for "lower upper" band → bot fetches price
// → asks for stake → executes mint_range.

bot.callbackQuery(/^range:([a-f0-9]+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const prefix = ctx.match[1]!;
  try {
    const oracles = await listOracles();
    const oracle = oracles.find((o) => o.oracle_id.slice(2).startsWith(prefix));
    if (!oracle) {
      await ctx.answerCallbackQuery({ text: "Market no longer active." });
      return;
    }
    if (oracle.status !== "active" || oracle.expiry <= Date.now() + 30_000) {
      await ctx.answerCallbackQuery({ text: "Market expired." });
      return;
    }
    const state = await getOracleState(oracle.oracle_id);
    const spot = state.latest_price?.spot ?? 0;
    const spotStr = spot ? formatSpotUsd(spot) : "?";

    setPending(telegramId, {
      kind: "awaiting_range_band",
      oracleId: oracle.oracle_id,
      symbol: oracle.underlying_asset,
      createdAt: Date.now(),
    });

    await ctx.reply(
      [
        `📦 *Range bet on ${oracle.underlying_asset}*`,
        `Live spot: ${spotStr}  ·  settles in ${formatTtl(oracle.expiry - Date.now())}`,
        ``,
        `Reply with the band you want to bet on (lower upper).`,
        `Example: \`70000 72000\` = "BTC ends between $70k and $72k"`,
        ``,
        `_Send /cancel to abort._`,
        `_Polymarket can't do this — only DeepBook Predict supports continuous range bets._`,
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: { force_reply: true, selective: true },
      },
    );
    await ctx.answerCallbackQuery();
  } catch (err) {
    await ctx.answerCallbackQuery({ text: (err as Error).message });
  }
});

// ─── Custom Mode ─────────────────────────────────────────────────────────
// User taps "🎯 Custom" → picks UP/DOWN → enters strike → enters stake → bet.

bot.callbackQuery(/^custom:([a-f0-9]+)$/, async (ctx) => {
  const prefix = ctx.match[1]!;
  try {
    const oracles = await listOracles();
    const oracle = oracles.find((o) => o.oracle_id.slice(2).startsWith(prefix));
    if (!oracle) {
      await ctx.answerCallbackQuery({ text: "Market no longer active." });
      return;
    }
    const state = await getOracleState(oracle.oracle_id);
    const spotStr = state.latest_price?.spot ? formatSpotUsd(state.latest_price.spot) : "?";
    const kb = new InlineKeyboard()
      .text(`↑ UP custom`, `customside:up:${prefix}`)
      .text(`↓ DOWN custom`, `customside:down:${prefix}`)
      .row()
      .text("← Back", "ui:markets");
    await ctx.reply(
      [
        `🎯 *Custom strike on ${oracle.underlying_asset}*`,
        `Live spot: ${spotStr}`,
        ``,
        `Pick side first:`,
      ].join("\n"),
      { parse_mode: "Markdown", reply_markup: kb },
    );
    await ctx.answerCallbackQuery();
  } catch (err) {
    await ctx.answerCallbackQuery({ text: (err as Error).message });
  }
});

bot.callbackQuery(/^customside:(up|down):([a-f0-9]+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const side = ctx.match[1] as "up" | "down";
  const prefix = ctx.match[2]!;
  try {
    const oracles = await listOracles();
    const oracle = oracles.find((o) => o.oracle_id.slice(2).startsWith(prefix));
    if (!oracle) {
      await ctx.answerCallbackQuery({ text: "Market no longer active." });
      return;
    }
    setPending(telegramId, {
      kind: "awaiting_custom_strike",
      oracleId: oracle.oracle_id,
      symbol: oracle.underlying_asset,
      side,
      createdAt: Date.now(),
    });
    const state = await getOracleState(oracle.oracle_id);
    const spotStr = state.latest_price?.spot ? formatSpotUsd(state.latest_price.spot) : "?";
    const arrow = side === "up" ? "↑" : "↓";
    await ctx.reply(
      [
        `🎯 *Custom ${oracle.underlying_asset} ${arrow} ${side.toUpperCase()}*`,
        `Live spot: ${spotStr}`,
        ``,
        `Reply with your strike (whole dollars).`,
        `Example: \`70500\` means "BTC ${side === "up" ? "above" : "below"} $70,500 at settlement".`,
        ``,
        `_Send /cancel to abort._`,
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: { force_reply: true, selective: true },
      },
    );
    await ctx.answerCallbackQuery();
  } catch (err) {
    await ctx.answerCallbackQuery({ text: (err as Error).message });
  }
});

bot.callbackQuery(/^cashout:([a-zA-Z0-9]+)$/, async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const id = ctx.match[1]!;
  try {
    await ctx.answerCallbackQuery();
    await cashoutPositionForUser(ctx, telegramId, id);
  } catch (err) {
    await ctx.reply(`❌ Error: ${(err as Error).message}`);
  }
});

// Market card navigation: switch asset, back to markets list, how-it-works,
// and the Strike Studio (deferred — placeholder for now).
bot.callbackQuery(/^switch:([A-Z0-9]+)$/, async (ctx) => {
  const asset = ctx.match[1]!;
  await ctx.answerCallbackQuery();
  await editToMarkets(ctx, asset);
});

bot.callbackQuery(/^ui:markets$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await editToMarkets(ctx);
});

bot.callbackQuery(/^how:works$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    [
      "💡 *How Hunchbook works*",
      "",
      "Each market is a binary bet: will BTC end *above* or *below* a strike at expiry?",
      "",
      "Unlike Polymarket where strikes are fixed ($70k, $75k...), DeepBook lets you pick *any* strike in $1 increments from $50k up. Lower-probability bets cost less and pay more.",
      "",
      "Tap a *Quick bet* tile for a curated strike, or *🎛 Strike Studio* to dial in your own.",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
});

bot.callbackQuery(/^studio:([a-f0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Strike Studio coming next — tap 🎯 Custom for now." });
});

// ──────────────────────────────────────────────────────────────────────────
// Text fallback — handles quantity entry after a "tap UP" button
// ──────────────────────────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  if (Object.values(NAV).includes(text as typeof NAV[keyof typeof NAV])) return;

  const pending = getPending(telegramId);
  if (!pending) return;

  try {
    if (pending.kind === "awaiting_bet_amount") {
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply("Not a positive number. Try `1` or `2.5`.", {
          parse_mode: "Markdown",
        });
        return;
      }
      clearPending(telegramId);
      const oracles = await listOracles();
      const oracle = oracles.find((o) => o.oracle_id === pending.oracleId);
      if (!oracle) {
        await ctx.reply("Market no longer active. Tap 📊 Markets.");
        return;
      }
      await placeBetForUser(
        ctx,
        telegramId,
        oracle,
        pending.side,
        amount,
        pending.strike,
      );
      return;
    }

    if (pending.kind === "awaiting_range_band") {
      // Expect "lower upper" e.g. "70000 72000"
      const parts = text.split(/\s+/).map(Number);
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
        await ctx.reply(
          "Need two positive numbers separated by a space.\nExample: `70000 72000`",
          { parse_mode: "Markdown" },
        );
        return;
      }
      const lowerNum = Math.min(parts[0]!, parts[1]!);
      const higherNum = Math.max(parts[0]!, parts[1]!);
      if (lowerNum === higherNum) {
        await ctx.reply("Lower and upper must differ. Try again.");
        return;
      }
      const oracles = await listOracles();
      const oracle = oracles.find((o) => o.oracle_id === pending.oracleId);
      if (!oracle) {
        clearPending(telegramId);
        await ctx.reply("Market no longer active.");
        return;
      }
      const tick = BigInt(oracle.tick_size);
      const lowerStrike =
        (BigInt(Math.floor(lowerNum)) * 1_000_000_000n / tick) * tick;
      const higherStrike =
        (BigInt(Math.floor(higherNum)) * 1_000_000_000n / tick) * tick;

      // Preview price via devInspect
      const previewTx = new Transaction();
      const keyArg = addRangeKey(previewTx, {
        oracleId: oracle.oracle_id,
        expiry: BigInt(oracle.expiry),
        lowerStrike,
        higherStrike,
      });
      addGetRangeTradeAmountsCall(previewTx, {
        oracleId: oracle.oracle_id,
        keyArg,
        quantity: 1_000_000n,
      });
      let pricePerUnit: bigint | undefined;
      try {
        const dry = await sui.devInspectTransactionBlock({
          sender: "0x0000000000000000000000000000000000000000000000000000000000000001",
          transactionBlock: previewTx,
        });
        if (dry.effects.status.status === "success") {
          const bytes = dry.results?.[1]?.returnValues?.[0]?.[0];
          if (bytes) pricePerUnit = readU64Le(bytes);
        }
      } catch {/* ignore */}

      setPending(telegramId, {
        kind: "awaiting_range_amount",
        oracleId: oracle.oracle_id,
        symbol: oracle.underlying_asset,
        lowerStrike,
        higherStrike,
        createdAt: Date.now(),
      });

      const priceLine = pricePerUnit
        ? `Price: *${formatPriceCents(pricePerUnit)} per $1 of payout*`
        : "";
      await ctx.reply(
        [
          `📦 *Range bet preview*`,
          `Band: ${formatStrikeUsd(lowerStrike)} – ${formatStrikeUsd(higherStrike)}`,
          priceLine,
          ``,
          `*How much do you want to bet?*`,
          `Reply with $ of max payout (e.g. \`5\`).`,
          ``,
          `_Send /cancel to abort._`,
        ].filter(Boolean).join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: { force_reply: true, selective: true },
        },
      );
      return;
    }

    if (pending.kind === "awaiting_range_amount") {
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply("Not a positive number. Try `1` or `5`.", {
          parse_mode: "Markdown",
        });
        return;
      }
      clearPending(telegramId);
      const oracles = await listOracles();
      const oracle = oracles.find((o) => o.oracle_id === pending.oracleId);
      if (!oracle) {
        await ctx.reply("Market no longer active.");
        return;
      }
      await placeRangeBetForUser(
        ctx,
        telegramId,
        oracle,
        pending.lowerStrike,
        pending.higherStrike,
        amount,
      );
      return;
    }

    if (pending.kind === "awaiting_custom_strike") {
      const strikeDollars = Number(text);
      if (!Number.isFinite(strikeDollars) || strikeDollars <= 0) {
        await ctx.reply("Strike must be a positive number. Try `70500`.");
        return;
      }
      const oracles = await listOracles();
      const oracle = oracles.find((o) => o.oracle_id === pending.oracleId);
      if (!oracle) {
        clearPending(telegramId);
        await ctx.reply("Market no longer active.");
        return;
      }
      const tick = BigInt(oracle.tick_size);
      const strike =
        (BigInt(Math.floor(strikeDollars)) * 1_000_000_000n / tick) * tick;

      // Preview price
      const previewTx = new Transaction();
      const keyArg =
        pending.side === "up"
          ? addMarketKeyUp(previewTx, {
              oracleId: oracle.oracle_id,
              expiry: BigInt(oracle.expiry),
              strike,
            })
          : addMarketKeyDown(previewTx, {
              oracleId: oracle.oracle_id,
              expiry: BigInt(oracle.expiry),
              strike,
            });
      addGetTradeAmountsCall(previewTx, {
        oracleId: oracle.oracle_id,
        keyArg,
        quantity: 1_000_000n,
      });
      let pricePerUnit: bigint | undefined;
      try {
        const dry = await sui.devInspectTransactionBlock({
          sender: "0x0000000000000000000000000000000000000000000000000000000000000001",
          transactionBlock: previewTx,
        });
        if (dry.effects.status.status === "success") {
          const bytes = dry.results?.[1]?.returnValues?.[0]?.[0];
          if (bytes) pricePerUnit = readU64Le(bytes);
        }
      } catch {/* ignore */}

      setPending(telegramId, {
        kind: "awaiting_bet_amount",
        oracleId: oracle.oracle_id,
        side: pending.side,
        symbol: oracle.underlying_asset,
        vibe: "custom",
        strike,
        createdAt: Date.now(),
      });

      const arrow = pending.side === "up" ? "↑" : "↓";
      const direction = pending.side === "up" ? "above" : "below";
      const priceLine = pricePerUnit
        ? `Price: *${formatPriceCents(pricePerUnit)} per $1 of payout*`
        : "";
      await ctx.reply(
        [
          `🎯 *Custom — ${oracle.underlying_asset} ${arrow} ${pending.side.toUpperCase()}*`,
          `Strike: *${formatStrikeUsd(strike)}*`,
          priceLine,
          ``,
          `Wins if ${oracle.underlying_asset} ends *${direction}* ${formatStrikeUsd(strike)}.`,
          ``,
          `*How much do you want to bet?*`,
          `Reply with $ of max payout (e.g. \`5\`).`,
          ``,
          `_Send /cancel to abort._`,
        ].filter(Boolean).join("\n"),
        {
          parse_mode: "Markdown",
          reply_markup: { force_reply: true, selective: true },
        },
      );
      return;
    }
  } catch (err) {
    await ctx.reply(`❌ Error: ${(err as Error).message}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("grammY error:", err);
});

// ──────────────────────────────────────────────────────────────────────────
// Auto-pilot background runner
//
// Every 60s, list active autopilots. For each, if (now - last_run_at) >=
// interval_ms AND there's remaining budget, fire a bet via placeBetForUser
// with a sentinel ctx that pushes notifications to the user's chat.
// ──────────────────────────────────────────────────────────────────────────

async function autopilotTick() {
  const active = db.listActiveAutopilots();
  const now = Date.now();
  for (const ap of active) {
    try {
      const remainingBudget = ap.budget_raw - ap.spent_raw;
      if (remainingBudget < ap.amount_raw) {
        db.setAutopilotActive(ap.telegram_id, false);
        await bot.api.sendMessage(
          ap.telegram_id,
          "🔴 *Auto-pilot stopped* — budget exhausted.",
          { parse_mode: "Markdown" },
        );
        continue;
      }
      const due = !ap.last_run_at || now - ap.last_run_at >= ap.interval_ms;
      if (!due) continue;

      // Find the next BTC market that expires within the autopilot's interval
      const oracles = await listOracles();
      const oracle = oracles
        .filter(
          (o) =>
            o.status === "active" &&
            o.underlying_asset === ap.asset &&
            o.expiry > now + 30_000 &&
            o.expiry - now <= ap.interval_ms * 2, // tolerate up to 2 intervals out
        )
        .sort((a, b) => a.expiry - b.expiry)[0];
      if (!oracle) continue;

      const state = await getOracleState(oracle.oracle_id);
      const spot = state.latest_price?.spot ?? 0;
      if (!spot) continue;
      const tick = BigInt(oracle.tick_size);
      const side = ap.side as "up" | "down";
      const vibe = ap.vibe as Vibe;
      const strike = strikeForVibe(BigInt(spot), tick, vibe, side);
      const amount = ap.amount_raw / 1_000_000;

      // Synthesize a minimal ctx so placeBetForUser can `reply` to the user
      const fakeCtx = {
        reply: async (text: string, opts?: object) => {
          await bot.api.sendMessage(ap.telegram_id, text, opts as never);
          return undefined as never;
        },
      } as unknown as Context;

      await bot.api.sendMessage(
        ap.telegram_id,
        `🤖 Auto-pilot firing: ${vibe.toUpperCase()} ${side.toUpperCase()} $${amount} on ${oracle.underlying_asset}`,
      );

      await placeBetForUser(fakeCtx, ap.telegram_id, oracle, side, amount, strike);
      db.recordAutopilotRun(ap.telegram_id, ap.amount_raw);
    } catch (err) {
      console.error(`autopilot ${ap.telegram_id} failed:`, (err as Error).message);
      try {
        await bot.api.sendMessage(
          ap.telegram_id,
          `⚠️ Auto-pilot tick failed: ${(err as Error).message}`,
        );
      } catch {/* ignore */}
    }
  }
}

const autopilotInterval = setInterval(() => {
  autopilotTick().catch((err) => console.error("autopilot tick crashed:", err));
}, 60_000);

console.log("Hunchbook bot starting...");
console.log(`  DB: ${DB_PATH}`);
bot.start({
  onStart: (info) => console.log(`  Connected as @${info.username}`),
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  clearInterval(autopilotInterval);
  bot.stop();
  db.close();
  process.exit(0);
});
