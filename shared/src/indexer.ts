import { PREDICT_INDEXER_URL, PREDICT_OBJECT_ID } from "./config";

export interface IndexerOracle {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: "active" | "settled" | "pending_settlement" | "inactive";
  activated_at: number | null;
  settlement_price: number | null;
  settled_at: number | null;
  created_checkpoint: number;
}

export interface IndexerLatestPrice {
  spot: number;
  forward: number;
  onchain_timestamp: number;
  checkpoint_timestamp_ms: number;
  [key: string]: unknown;
}

export interface IndexerOracleState {
  oracle: IndexerOracle;
  latest_price: IndexerLatestPrice | null;
  latest_svi: Record<string, unknown> | null;
  ask_bounds: unknown;
  [key: string]: unknown;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}\n${text}`);
  }
  return (await res.json()) as T;
}

export async function listOracles(): Promise<IndexerOracle[]> {
  return getJson<IndexerOracle[]>(
    `${PREDICT_INDEXER_URL}/predicts/${PREDICT_OBJECT_ID}/oracles`,
  );
}

export async function getOracleState(
  oracleId: string,
): Promise<IndexerOracleState> {
  return getJson<IndexerOracleState>(
    `${PREDICT_INDEXER_URL}/oracles/${oracleId}/state`,
  );
}

export interface IndexerManager {
  manager_id: string;
  owner: string;
  [key: string]: unknown;
}

export async function listManagersForOwner(
  owner: string,
): Promise<IndexerManager[]> {
  return getJson<IndexerManager[]>(
    `${PREDICT_INDEXER_URL}/managers?owner=${owner}`,
  );
}

export function pickRoundTripOracle(
  oracles: IndexerOracle[],
  opts: { now: number; minMs: number; maxMs: number; asset?: string },
): IndexerOracle | null {
  const candidates = oracles
    .filter((o) => o.status === "active")
    .filter((o) => !opts.asset || o.underlying_asset === opts.asset)
    .filter((o) => {
      const dt = o.expiry - opts.now;
      return dt >= opts.minMs && dt <= opts.maxMs;
    })
    .sort((a, b) => a.expiry - b.expiry);
  return candidates[0] ?? null;
}
