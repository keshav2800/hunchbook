import type { SviParams } from '@/lib/svi';

export type Direction = 'UP' | 'DOWN';

export interface LiveMarket {
  oracleId: string;
  pair: string; // 'BTC/USD'
  spot: number; // USD floats — decoded at the gateway
  forward: number;
  expiry: number; // unix ms
  minStrike: number;
  tickSize: number;
  svi: SviParams | null; // null if the oracle has no SVI fit yet
  sparkline: number[]; // recent spot ticks, oldest → newest
  sparkTimes: number[]; // unix ms for each sparkline tick, oldest → newest (same length)
  sessionChangePct: number; // change over the tick buffer window
}

export interface BetPosition {
  oracleId: string;
  expiry: number; // unix ms
  strikeUsd: number;
  direction: Direction;
  units: number; // $1-payout units (quantity / 1e6)
  stakeUsd: number | null; // reconstructed from place_bet tx history
  status: 'active' | 'settled';
  won: boolean | null; // null while active
  settlementUsd: number | null;
}

export interface BetHistoryEntry {
  digest: string;
  timestampMs: number;
  oracleId: string;
  expiry: number;
  strikeUsd: number;
  direction: Direction;
  stakeUsd: number;
  units: number;
  outcome: 'won' | 'lost' | 'open' | 'cashed_out';
  settlementUsd: number | null;
  /** Actual dUSDC received for cashed_out / claimed wins; face value (units) for
   *  unclaimed wins; 0 for losses; null while open. Pre-fee for unclaimed wins. */
  payoutUsd: number | null;
}

export interface BetStats {
  totalBets: number;
  wins: number;
  losses: number;
  cashedOut: number;
  wageredUsd: number;
}

export interface VaultStats {
  tvlUsd: number;
  /** NAV per share. 1.0 when the vault has no shares yet. */
  sharePrice: number;
  /** ~24h change. Null while the vault is younger than 24h. */
  sharePriceChangePct: number | null;
  /** Annualized from share-price history. Null while history spans < 24h. */
  apyPct: number | null;
  /** Signed-in user's PFSHARE value at the current share price. Null when signed out. */
  userPositionUsd: number | null;
  userShares: number | null;
  composition: { label: string; pct: number }[];
  history: { date: string; nav: number; drawdownPct: number }[];
  recentTransactions: VaultTransaction[];
}

export interface VaultTransaction {
  digest: string;
  type: 'Deposit' | 'Withdraw';
  amountUsd: number;
  lp: string;
  timestampMs: number;
}

export type LeaderboardPeriod = 'weekly' | 'all-time';

export interface LeaderboardEntry {
  rank: number;
  address: string;
  winRatePct: number; // settled bets only; 0 when nothing settled
  wageredUsd: number; // ranking key
  totalBets: number;
  wins: number;
  losses: number;
}

export interface StreakInfo {
  currentDays: number;
  milestones: number[]; // [3, 7, 14, 30]
}
