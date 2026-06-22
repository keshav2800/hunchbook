'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { usePlaceBet } from '@/lib/use-place-bet';
import { atmStrike } from '@/components/trade/quick-bet-panel';
import { binaryUpProbability, probabilityToOdds, strikeForWinProbability } from '@/lib/svi';
import type { BetPosition, Direction, LiveMarket } from '@/lib/types';

export type OnLoss = 'reset' | 'increase';

export interface AutoBetConfig {
  direction: Direction;
  targetWinProb: number; // risk tier — strike is re-solved each round to hit this
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
  status: 'pending' | 'win' | 'loss' | 'error';
  direction: Direction;
  strike: number; // the level this bet needs to beat
  stake: number; // staked this round
  payout: number; // potential gross payout while pending; actual payout once won
  pnl: number; // realized P&L once settled (0 while pending)
  note?: string;
}

export interface AutoBetState {
  status: 'idle' | 'running' | 'done';
  round: number;
  maxRounds: number; // mirrored from the active config so the cockpit survives a refresh
  sessionPnl: number;
  streak: number; // current consecutive wins
  stake: number; // stake for the next/active round
  log: RoundLog[];
  config: AutoBetConfig | null; // the active run's settings — drives the setup summary, survives refresh
  pendingExpiry: number | null; // expiry (ms) of the in-flight bet, for the live "settles in" countdown
  endedReason?: string;
}

const IDLE: AutoBetState = {
  status: 'idle',
  round: 0,
  maxRounds: 0,
  sessionPnl: 0,
  streak: 0,
  stake: 0,
  log: [],
  config: null,
  pendingExpiry: null,
};

const ROLL_BUFFER_MS = 30_000; // never enter a market about to freeze
const POLL_MS = 6_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- Persistence: a running session survives refresh / reopen ---- */

const STORAGE_KEY = 'hunchbook.autobet.v1';
const SESSION_MAX_AGE_MS = 6 * 60 * 60_000; // don't resurrect a long-forgotten run

interface PersistedSession {
  owner: string;
  updatedAt: number;
  config: AutoBetConfig;
  round: number;
  pnl: number;
  streak: number;
  stake: number;
  logId: number;
  log: RoundLog[];
  // A bet placed but not yet confirmed settled, so a resume waits it out.
  // `betId` points at its row in `log`, which a resume updates in place.
  pending: { oracleId: string; expiry: number; stake: number; betId: number } | null;
}

function loadSession(): PersistedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedSession;
    if (!p || Date.now() - p.updatedAt > SESSION_MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

function saveSession(p: PersistedSession) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...p, updatedAt: Date.now() }));
  } catch {
    /* quota / private mode — degrade to in-memory only */
  }
}

function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

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
  const resumedRef = useRef(false);
  // Tells a winding-down loop *why* it's stopping: `true` = paused by navigation
  // (keep the session + pending bet for resume), `false` = explicit user stop
  // (tear down). Without this, a route change would clear the saved session.
  const pausedRef = useRef(false);

  // Explicit stop tears the session down and returns to the config form so the
  // bettor can set up a fresh run. (Natural completion shows a recap instead.)
  const stop = useCallback(() => {
    pausedRef.current = false;
    runningRef.current = false;
    clearSession();
    setState(IDLE);
  }, []);

  // Component unmount (route change / refresh) pauses the in-memory loop, but
  // leaves the persisted session intact so it resumes on the next mount.
  useEffect(() => () => {
    pausedRef.current = true;
    runningRef.current = false;
  }, []);

  const reset = useCallback(() => {
    clearSession();
    setState(IDLE);
  }, []);

  // Core runner — drives a session from `init` (fresh start or restored).
  const run = useCallback(
    async (init: PersistedSession) => {
      if (!account || runningRef.current) return;
      if (init.owner !== account.address) return; // never run someone else's saved session
      runningRef.current = true;
      pausedRef.current = false;
      const owner = account.address;
      const cfg = init.config;

      let manager = await fetchManagerId(owner); // placeBet creates one on first bet if null
      let stake = init.stake;
      let pnl = init.pnl;
      let streak = init.streak;
      let round = init.round;
      let logId = init.logId;
      let pending = init.pending;
      let errors = 0; // consecutive placement failures
      const log: RoundLog[] = [...init.log];

      setState({ status: 'running', round, maxRounds: cfg.maxRounds, sessionPnl: pnl, streak, stake, log: [...log], config: cfg, pendingExpiry: pending?.expiry ?? null });

      const persist = () =>
        saveSession({ owner, updatedAt: Date.now(), config: cfg, round, pnl, streak, stake, logId, log, pending });
      persist();

      const finish = (reason: string) => {
        runningRef.current = false;
        clearSession();
        setState((s) => ({ ...s, status: 'done', endedReason: reason }));
      };

      // Settle the bet row `betId` against the stake at risk, updating it in place.
      const settle = (
        betId: number,
        outcome: { won: boolean; units: number } | null,
        atRisk: number,
      ): RoundLog['status'] => {
        let roundPnl = 0;
        let status: RoundLog['status'] = 'error';
        let finalPayout: number | undefined;
        if (outcome) {
          if (outcome.won) {
            roundPnl = outcome.units - atRisk; // payout (units × $1) minus stake
            finalPayout = outcome.units;
            status = 'win';
            streak++;
          } else {
            roundPnl = -atRisk;
            status = 'loss';
            streak = 0;
          }
          pnl += roundPnl;
        }
        const idx = log.findIndex((l) => l.id === betId);
        if (idx >= 0) {
          log[idx] = {
            ...log[idx],
            status,
            pnl: roundPnl,
            payout: finalPayout ?? log[idx].payout,
            note: outcome ? log[idx].note : 'settlement unconfirmed',
          };
        }
        // Settlement resolves the in-flight bet → clear the countdown.
        setState((s) => ({ ...s, sessionPnl: pnl, streak, log: [...log], pendingExpiry: null }));
        return status;
      };

      const stopHit = (): string | null => {
        if (cfg.takeProfitUsd != null && pnl >= cfg.takeProfitUsd) return 'Take-profit hit';
        if (cfg.stopLossUsd != null && pnl <= -cfg.stopLossUsd) return 'Stop-loss hit';
        return null;
      };

      const adjustStake = (result: RoundLog['status']) => {
        stake =
          result === 'win'
            ? cfg.baseStakeUsd
            : cfg.onLoss === 'increase'
              ? Math.round(stake * (1 + cfg.increasePct / 100) * 100) / 100 // keep cents
              : cfg.baseStakeUsd;
      };

      // Resolve a bet that was in flight when we refreshed, before placing more.
      if (pending) {
        manager = manager ?? (await fetchManagerId(owner));
        const { betId, stake: atRisk, oracleId, expiry } = pending;
        const outcome = await waitForSettlement(manager, owner, oracleId, expiry, () => runningRef.current);
        if (!runningRef.current) {
          // Paused (navigated away) before settling — leave the bet pending and
          // keep the session so the next mount resumes waiting on it.
          if (pausedRef.current) persist();
          return;
        }
        pending = null;
        const result = settle(betId, outcome, atRisk);
        persist();
        const hit = stopHit();
        if (hit) return finish(hit);
        adjustStake(result);
        persist();
      }

      while (runningRef.current && round < cfg.maxRounds) {
        const market = nextOpenMarket(await fetchMarkets());
        if (!market) {
          await sleep(4000);
          continue; // no live market yet — wait and retry (doesn't burn a round)
        }
        // Re-solve the strike for the chosen risk tier against this round's live
        // market, so the win-probability stays put even as spot/vol/expiry move.
        const strike = market.svi
          ? strikeForWinProbability(market.forward, cfg.direction, cfg.targetWinProb, market.svi, market.tickSize, market.minStrike)
          : atmStrike(market);
        const pUp = market.svi ? binaryUpProbability(market.forward, strike, market.svi) : 0.5;
        const pWin = cfg.direction === 'UP' ? pUp : 1 - pUp;
        const payout = pWin > 0 ? stake * probabilityToOdds(pWin) : 0; // potential gross win

        try {
          await placeBet.mutateAsync({ market, direction: cfg.direction, strikeUsd: strike, stakeUsd: stake, pWin });
        } catch (e) {
          errors++;
          const msg = e instanceof Error ? e.message : 'placement failed';
          log.unshift({ id: logId++, round: round + 1, status: 'error', direction: cfg.direction, strike, stake, payout: 0, pnl: 0, note: msg });
          setState((s) => ({ ...s, log: [...log] }));
          persist();
          // Non-transient failures (e.g. stake too small) won't fix themselves —
          // stop after a few tries instead of looping forever.
          if (errors >= 3) return finish(msg);
          await sleep(3000);
          continue; // retry without consuming a round
        }
        errors = 0;
        round++;
        const betId = logId++;
        // Record the bet the instant it's placed, so the list shows it (and its
        // potential payout) while it's still pending.
        log.unshift({ id: betId, round, status: 'pending', direction: cfg.direction, strike, stake, payout, pnl: 0 });
        pending = { oracleId: market.oracleId, expiry: market.expiry, stake, betId };
        setState((s) => ({ ...s, round, stake, log: [...log], pendingExpiry: market.expiry }));
        persist(); // a refresh right after placing now knows about the in-flight bet

        manager = manager ?? (await fetchManagerId(owner));
        const outcome = await waitForSettlement(manager, owner, market.oracleId, market.expiry, () => runningRef.current);
        if (!runningRef.current) {
          // Paused/stopped while waiting. Keep the bet pending for resume (an
          // explicit stop already cleared the session via stop()).
          if (pausedRef.current) persist();
          return;
        }
        const atRisk = stake;
        pending = null;
        const result = settle(betId, outcome, atRisk);
        persist();

        const hit = stopHit();
        if (hit) return finish(hit);
        adjustStake(result);
        persist();
      }

      // Natural completion clears + marks done. A pause (navigation) keeps the
      // session for resume; an explicit stop() already tore everything down.
      if (runningRef.current) finish('All rounds played');
      else if (pausedRef.current) persist();
    },
    [account, placeBet],
  );

  const start = useCallback(
    async (cfg: AutoBetConfig) => {
      if (!account || runningRef.current) return;
      await run({
        owner: account.address,
        updatedAt: Date.now(),
        config: cfg,
        round: 0,
        pnl: 0,
        streak: 0,
        stake: cfg.baseStakeUsd,
        logId: 0,
        log: [],
        pending: null,
      });
    },
    [account, run],
  );

  // When the signed-in account changes (signout, or switch to a different
  // address) the in-memory run belongs to the *old* account — abandon it so the
  // UI doesn't show someone else's session as still running. The old account's
  // persisted session is left intact (pausedRef) so it can resume on re-login,
  // and resume is re-armed so the new account can pick up its own saved session.
  const prevAddrRef = useRef<string | undefined>(account?.address);
  useEffect(() => {
    const addr = account?.address;
    if (prevAddrRef.current === addr) return;
    prevAddrRef.current = addr;
    runningRef.current = false;
    pausedRef.current = true; // keep the old account's saved session for resume
    resumedRef.current = false; // let the new account resume its own session
    setState(IDLE);
  }, [account?.address]);

  // On mount (and once the account is known), resume a session left running by
  // a previous page load. Guarded so it only fires once.
  useEffect(() => {
    if (resumedRef.current || runningRef.current || !account) return;
    const saved = loadSession();
    if (!saved || saved.owner !== account.address) return;
    resumedRef.current = true;
    void run(saved);
  }, [account, run]);

  return { state, start, stop, reset };
}
