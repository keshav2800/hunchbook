'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { usePlaceBet } from '@/lib/use-place-bet';
import { atmStrike } from '@/components/trade/quick-bet-panel';
import { binaryUpProbability } from '@/lib/svi';
import type { BetPosition, Direction, LiveMarket } from '@/lib/types';

/*
 * Client-side auto-bet engine (Stake-style). Runs entirely while the tab is
 * open, reusing the existing single-bet flow (usePlaceBet): place → wait for
 * settlement (poll /api/positions) → adjust stake → roll into the next expiry,
 * until a stop condition fires. Every run is bounded (mandatory maxRounds +
 * optional stop-loss/take-profit) and abortable in one call (stop()).
 */

export type OnLoss = 'reset' | 'increase';

export interface AutoBetConfig {
  direction: Direction;
  baseStakeUsd: number;
  onLoss: OnLoss;
  increasePct: number; // used when onLoss === 'increase'
  maxRounds: number; // hard cap — always finite
  stopLossUsd: number | null; // stop when session P&L ≤ −this
  takeProfitUsd: number | null; // stop when session P&L ≥ this
}

export interface RoundLog {
  id: number; // unique per entry (a failed+retried round can repeat `round`)
  round: number;
  result: 'win' | 'loss' | 'error';
  pnl: number;
  note?: string;
}

export interface AutoBetState {
  status: 'idle' | 'running' | 'done';
  round: number;
  sessionPnl: number;
  streak: number; // current consecutive wins
  stake: number; // stake for the next/active round
  log: RoundLog[];
  endedReason?: string;
}

const IDLE: AutoBetState = {
  status: 'idle',
  round: 0,
  sessionPnl: 0,
  streak: 0,
  stake: 0,
  log: [],
};

const ROLL_BUFFER_MS = 30_000; // never enter a market about to freeze
const POLL_MS = 6_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchMarkets(): Promise<LiveMarket[]> {
  try {
    const res = await fetch('/api/markets');
    if (!res.ok) return [];
    return (await res.json()) as LiveMarket[];
  } catch {
    return [];
  }
}

async function fetchManagerId(owner: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/manager?owner=${owner}`);
    if (!res.ok) return null;
    return ((await res.json()) as { managerId: string | null }).managerId;
  } catch {
    return null;
  }
}

async function fetchPositions(manager: string, owner: string): Promise<BetPosition[]> {
  try {
    const res = await fetch(`/api/positions?manager=${manager}&owner=${owner}`);
    if (!res.ok) return [];
    return ((await res.json()) as { positions: BetPosition[] }).positions ?? [];
  } catch {
    return [];
  }
}

function nextOpenMarket(markets: LiveMarket[]): LiveMarket | undefined {
  const now = Date.now();
  return [...markets].sort((a, b) => a.expiry - b.expiry).find((m) => m.expiry - now > ROLL_BUFFER_MS);
}

/** Poll positions until the bet on `oracleId` settles; returns null if aborted/timeout. */
async function waitForSettlement(
  manager: string | null,
  owner: string,
  oracleId: string,
  expiryMs: number,
  alive: () => boolean,
): Promise<{ won: boolean; units: number } | null> {
  const deadline = Math.max(expiryMs, Date.now()) + 5 * 60_000; // expiry + 5 min grace
  while (alive() && Date.now() < deadline) {
    await sleep(POLL_MS);
    const mgr = manager ?? (await fetchManagerId(owner));
    if (!mgr) continue;
    const settled = (await fetchPositions(mgr, owner)).find(
      (p) => p.oracleId === oracleId && p.status === 'settled',
    );
    // A won binary pays `units` dUSDC ($1/unit); settlementUsd is the BTC
    // settlement price, NOT the payout.
    if (settled) return { won: !!settled.won, units: settled.units };
  }
  return null;
}

export function useAutoBet() {
  const account = useCurrentAccount();
  const placeBet = usePlaceBet();
  const [state, setState] = useState<AutoBetState>(IDLE);
  const runningRef = useRef(false);

  const stop = useCallback(() => {
    runningRef.current = false;
  }, []);

  // Hard stop if the page unmounts — never keep auto-betting in the background.
  useEffect(() => () => {
    runningRef.current = false;
  }, []);

  const reset = useCallback(() => setState(IDLE), []);

  const start = useCallback(
    async (cfg: AutoBetConfig) => {
      if (!account || runningRef.current) return;
      runningRef.current = true;
      const owner = account.address;
      let manager = await fetchManagerId(owner); // placeBet creates one on first bet if null
      let stake = cfg.baseStakeUsd;
      let pnl = 0;
      let streak = 0;
      let round = 0;
      let logId = 0;
      let errors = 0; // consecutive placement failures
      const log: RoundLog[] = [];
      setState({ status: 'running', round: 0, sessionPnl: 0, streak: 0, stake, log: [] });

      const finish = (reason: string) => {
        runningRef.current = false;
        setState((s) => ({ ...s, status: 'done', endedReason: reason }));
      };

      while (runningRef.current && round < cfg.maxRounds) {
        const market = nextOpenMarket(await fetchMarkets());
        if (!market) {
          await sleep(4000);
          continue; // no live market yet — wait and retry (doesn't burn a round)
        }
        const strike = atmStrike(market);
        const pUp = market.svi ? binaryUpProbability(market.forward, strike, market.svi) : 0.5;
        const pWin = cfg.direction === 'UP' ? pUp : 1 - pUp;

        try {
          await placeBet.mutateAsync({ market, direction: cfg.direction, strikeUsd: strike, stakeUsd: stake, pWin });
        } catch (e) {
          errors++;
          const msg = e instanceof Error ? e.message : 'placement failed';
          log.unshift({ id: logId++, round: round + 1, result: 'error', pnl: 0, note: msg });
          setState((s) => ({ ...s, log: [...log] }));
          // Non-transient failures (e.g. stake too small) won't fix themselves —
          // stop after a few tries instead of looping forever.
          if (errors >= 3) return finish(msg);
          await sleep(3000);
          continue; // retry without consuming a round
        }
        errors = 0;
        round++;
        setState((s) => ({ ...s, round, stake }));

        manager = manager ?? (await fetchManagerId(owner));
        const outcome = await waitForSettlement(manager, owner, market.oracleId, market.expiry, () => runningRef.current);

        let roundPnl = 0;
        let result: RoundLog['result'] = 'error';
        if (outcome) {
          if (outcome.won) {
            roundPnl = outcome.units - stake; // payout (units × $1) minus what we staked
            result = 'win';
            streak++;
          } else {
            roundPnl = -stake;
            result = 'loss';
            streak = 0;
          }
          pnl += roundPnl;
        }
        log.unshift({ id: logId++, round, result, pnl: roundPnl, note: outcome ? undefined : 'settlement unconfirmed' });
        setState((s) => ({ ...s, sessionPnl: pnl, streak, log: [...log] }));

        if (cfg.takeProfitUsd != null && pnl >= cfg.takeProfitUsd) return finish('Take-profit hit');
        if (cfg.stopLossUsd != null && pnl <= -cfg.stopLossUsd) return finish('Stop-loss hit');

        stake =
          result === 'win'
            ? cfg.baseStakeUsd
            : cfg.onLoss === 'increase'
              ? Math.round(stake * (1 + cfg.increasePct / 100))
              : cfg.baseStakeUsd;
      }

      finish(runningRef.current ? 'All rounds played' : 'Stopped');
    },
    [account, placeBet],
  );

  return { state, start, stop, reset };
}
