'use client';

import { useEffect, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { motion, AnimatePresence, useMotionValueEvent, useSpring } from 'motion/react';
import { ArrowDown, ArrowUp, Flame, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PredictionChart } from '@/components/charts/prediction-chart';
import { EquityCurve } from '@/components/strike/equity-curve';
import { FaucetButton } from '@/components/auth/faucet-button';
import { atmStrike } from '@/components/trade/quick-bet-panel';
import { useAutoBet, type AutoBetConfig, type OnLoss, type RoundLog } from '@/lib/use-auto-bet';
import { useLiveMarkets, useOraclePrices } from '@/lib/hooks';
import { binaryUpProbability, probabilityToOdds, strikeForWinProbability } from '@/lib/svi';
import { formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Direction, LiveMarket } from '@/lib/types';

/** Smoothly tweened number for the live P&L count-up. */
function useTween(value: number): number {
  const spring = useSpring(value, { stiffness: 120, damping: 20 });
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  useMotionValueEvent(spring, 'change', (v) => setDisplay(v));
  return display;
}

const STAKE_PRESETS = [25, 100, 250] as const;

// Risk tiers. Each is a *target win-probability* for the chosen direction; the
// strike is re-solved every round to hit it, so "Safe" stays safe as price moves.
// Even ≈ the old at-the-money behaviour (~50% / ~2×).
type Tier = { id: string; label: string; target: number; blurb: string };
const RISK_TIERS: Tier[] = [
  { id: 'SAFE', label: 'Safe', target: 0.75, blurb: 'win often, small wins' },
  { id: 'EVEN', label: 'Even', target: 0.5, blurb: 'coin flip' },
  { id: 'LONGSHOT', label: 'Long shot', target: 0.3, blurb: 'rare, big payouts' },
];

/** Live win% + payout for a tier on the given market (snapped strike, net of fee). */
function tierOdds(market: LiveMarket, direction: Direction, target: number): { pWin: number; mult: number } {
  if (!market.svi) return { pWin: target, mult: 0 };
  const k = strikeForWinProbability(market.forward, direction, target, market.svi, market.tickSize, market.minStrike);
  const pUp = binaryUpProbability(market.forward, k, market.svi);
  const pWin = direction === 'UP' ? pUp : 1 - pUp;
  return { pWin, mult: probabilityToOdds(pWin) };
}

type Config = {
  baseStake: string;
  onLoss: OnLoss;
  increasePct: string;
  maxRounds: string;
  stopLoss: string;
  takeProfit: string;
};

/** Worst-case cumulative loss across a full losing run (capped by stop-loss). */
function worstCaseLoss(cfg: AutoBetConfig): number {
  let stake = cfg.baseStakeUsd;
  let total = 0;
  for (let i = 0; i < cfg.maxRounds; i++) {
    total += stake;
    if (cfg.stopLossUsd != null && total >= cfg.stopLossUsd) return cfg.stopLossUsd;
    stake = cfg.onLoss === 'increase' ? stake * (1 + cfg.increasePct / 100) : cfg.baseStakeUsd;
  }
  return cfg.stopLossUsd != null ? Math.min(total, cfg.stopLossUsd) : total;
}

export default function StrikeStudioPage() {
  const markets = useLiveMarkets();
  const market = markets.data?.[0]; // nearest expiry, for the live preview
  const account = useCurrentAccount();
  const { state, start, stop, reset } = useAutoBet();
  const pnlTween = useTween(state.sessionPnl);

  // Longer price history for the chart's x-axis (the market's own sparkline is
  // only ~3 min, which looks flat). Falls back to the sparkline until it loads.
  const prices = useOraclePrices(market?.oracleId, 15);
  const chartSpots = prices.data && prices.data.spots.length > 1 ? prices.data.spots : market?.sparkline ?? [];
  const chartTimes = prices.data && prices.data.times.length > 1 ? prices.data.times : market?.sparkTimes ?? [];

  const [direction, setDirection] = useState<Direction>('UP');
  const [tierId, setTierId] = useState<string>('EVEN');
  const [cfg, setCfg] = useState<Config>({
    baseStake: '25',
    onLoss: 'reset',
    increasePct: '50',
    maxRounds: '10',
    stopLoss: '125',
    takeProfit: '',
  });
  const set = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  if (!market) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[420px] w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const tier = RISK_TIERS.find((t) => t.id === tierId) ?? RISK_TIERS[1];
  // Strike the next round would actually take, for the chart + odds preview.
  const strike = market.svi
    ? strikeForWinProbability(market.forward, direction, tier.target, market.svi, market.tickSize, market.minStrike)
    : atmStrike(market);
  const { pWin, mult } = tierOdds(market, direction, tier.target);

  const config: AutoBetConfig = {
    direction,
    targetWinProb: tier.target,
    baseStakeUsd: Number(cfg.baseStake) || 0,
    onLoss: cfg.onLoss,
    increasePct: Number(cfg.increasePct) || 0,
    maxRounds: Math.max(1, Math.min(50, Number(cfg.maxRounds) || 10)),
    stopLossUsd: cfg.stopLoss ? Number(cfg.stopLoss) : null,
    takeProfitUsd: cfg.takeProfit ? Number(cfg.takeProfit) : null,
  };
  const maxAtRisk = worstCaseLoss(config);
  const running = state.status === 'running';
  const done = state.status === 'done';
  // While a run is active, the round total comes from the engine (it survives a
  // refresh); in the config view it tracks the form.
  const totalRounds = running || done ? state.maxRounds || config.maxRounds : config.maxRounds;
  const dots = Array.from({ length: totalRounds });

  // Cumulative-P&L series (oldest → newest) for the equity curve, leading 0.
  const settled = [...state.log].filter((l) => l.status === 'win' || l.status === 'loss').reverse();
  const equity = settled.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l.pnl], [0]);
  const wins = state.log.filter((l) => l.status === 'win').length;
  const losses = state.log.filter((l) => l.status === 'loss').length;
  // Most recent settled bet (log is newest-first), drives the win/loss flash.
  const lastSettled = state.log.find((l) => l.status === 'win' || l.status === 'loss');

  // Active-run settings + the in-flight bet, sourced from the engine so they
  // survive a refresh (the config form resets, but the running session does not).
  const runCfg = state.config;
  const runTier = runCfg
    ? RISK_TIERS.find((t) => Math.abs(t.target - runCfg.targetWinProb) < 0.001)
    : undefined;
  const runOdds = runCfg ? tierOdds(market, runCfg.direction, runCfg.targetWinProb) : null;
  const pendingBet = state.log.find((l) => l.status === 'pending');
  const historyBets = state.log.filter((l) => l.status !== 'pending');

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Chart */}
        <Card>
          <CardHeader className="flex-row items-center justify-start">
            <span className="font-mono text-2xl font-semibold tabular-nums">{formatUsd(market.spot)}</span>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            <PredictionChart
              spots={chartSpots}
              times={chartTimes}
              mode="single"
              strike={strike}
              direction={direction}
              lower={strike}
              upper={strike}
              tickSize={market.tickSize}
              minStrike={market.minStrike}
              label={market.pair}
              showStrike={false}
              className="h-full min-h-[420px]"
            />
          </CardContent>
        </Card>

        {/* Auto panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              {running ? (
                <span className="relative inline-flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-positive" />
                </span>
              ) : null}
              {running ? 'Auto-Bet · Running' : done ? 'Auto-Bet · Complete' : 'Auto-Bet'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {running || done ? (
              /* ---- Cockpit ---- */
              <>
                {/* What you're running — survives a refresh (engine-sourced). */}
                {runCfg ? (
                  <RunSummary
                    cfg={runCfg}
                    tierLabel={runTier?.label ?? `${formatPct(runCfg.targetWinProb * 100, false)} win`}
                    odds={runOdds}
                  />
                ) : null}

                {/* Round progress + streak */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Round <span className="font-mono tabular-nums text-foreground">{state.round}</span> / {totalRounds}
                    </span>
                    <AnimatePresence>
                      {state.streak >= 2 ? (
                        <motion.span
                          key={state.streak}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                          className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
                        >
                          <Flame className="size-3 fill-current" /> {state.streak} in a row
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </div>
                  {/* Segmented progress: each round fills + the live one shimmers. */}
                  <div className="flex gap-1">
                    {dots.map((_, i) => {
                      const r = state.log.find((l) => l.round === i + 1);
                      const isNext = !r && i + 1 === state.round + 1 && running;
                      const live = r?.status === 'pending' || isNext;
                      return (
                        <div key={i} className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                          <motion.div
                            initial={false}
                            animate={{ width: r || isNext ? '100%' : '0%' }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                            className={cn(
                              'absolute inset-y-0 left-0 rounded-full',
                              r?.status === 'win' && 'bg-positive',
                              r?.status === 'loss' && 'bg-negative/70',
                              r?.status === 'error' && 'bg-warning/70',
                              live && 'bg-primary',
                            )}
                          />
                          {live ? (
                            <motion.div
                              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                              animate={{ x: ['-100%', '320%'] }}
                              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Hero: session P&L + live equity curve */}
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0d0f14] p-4">
                  <AnimatePresence>
                    {lastSettled ? (
                      <motion.div
                        key={lastSettled.id}
                        initial={{ opacity: 0.4 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                        className={cn(
                          'pointer-events-none absolute inset-0',
                          lastSettled.status === 'win' ? 'bg-positive/25' : 'bg-negative/25',
                        )}
                      />
                    ) : null}
                  </AnimatePresence>
                  <div className="relative flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Session P&L</span>
                    {wins + losses > 0 ? (
                      <span className="font-mono text-[11px] tabular-nums">
                        <span className="text-positive">{wins}W</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-negative">{losses}L</span>
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      'relative font-mono text-4xl font-semibold tabular-nums',
                      state.sessionPnl > 0 ? 'text-positive' : state.sessionPnl < 0 ? 'text-negative' : 'text-foreground',
                    )}
                  >
                    {pnlTween >= 0 ? '+' : '-'}
                    {formatUsd(Math.abs(pnlTween))}
                  </div>
                  <div className="relative mt-1">
                    <EquityCurve points={equity} />
                  </div>
                </div>

                {/* The in-flight bet + a live countdown to settlement. */}
                <AnimatePresence>
                  {running && pendingBet ? (
                    <motion.div
                      key={pendingBet.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <CurrentBetCard bet={pendingBet} expiry={state.pendingExpiry} />
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {done && state.endedReason ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground"
                  >
                    {state.endedReason} · {wins}W / {losses}L
                  </motion.div>
                ) : null}

                {historyBets.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">History</div>
                    <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                      <AnimatePresence initial={false}>
                        {historyBets.map((l) => (
                          <motion.div
                            key={l.id}
                            layout
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className={cn(
                              'flex items-center justify-between gap-2 rounded-lg border-l-2 bg-white/[0.02] px-2.5 py-2 text-xs',
                              l.status === 'win' && 'border-positive',
                              l.status === 'loss' && 'border-negative',
                              l.status === 'error' && 'border-warning',
                            )}
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="flex items-center gap-1 font-medium">
                                {l.direction === 'UP' ? (
                                  <ArrowUp className="size-3 text-positive" />
                                ) : (
                                  <ArrowDown className="size-3 text-negative" />
                                )}
                                {l.direction === 'UP' ? 'Higher' : 'Lower'} {formatUsd(l.strike, 0)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                R{l.round} · {formatUsd(l.stake)} stake
                              </span>
                            </div>
                            <div className="shrink-0 text-right">
                              {l.status === 'error' ? (
                                <span className="font-medium uppercase text-warning">Error</span>
                              ) : (
                                <>
                                  <span
                                    className={cn(
                                      'text-[10px] font-semibold uppercase tracking-wide',
                                      l.status === 'win' ? 'text-positive' : 'text-negative',
                                    )}
                                  >
                                    {l.status}
                                  </span>
                                  <div
                                    className={cn(
                                      'font-mono text-sm tabular-nums',
                                      l.pnl >= 0 ? 'text-positive' : 'text-negative',
                                    )}
                                  >
                                    {l.pnl >= 0 ? '+' : '-'}
                                    {formatUsd(Math.abs(l.pnl))}
                                  </div>
                                </>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ) : null}

                {running ? (
                  <Button
                    size="lg"
                    className="w-full gap-2 bg-foreground font-semibold uppercase tracking-wider text-background hover:bg-foreground/90"
                    onClick={() => {
                      stop();
                      toast('Auto-bet stopped', { description: 'Set up a new run below.' });
                    }}
                  >
                    <Square className="size-4 fill-current" /> Stop &amp; reconfigure
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" className="w-full" onClick={reset}>
                    New auto-bet
                  </Button>
                )}
                {running ? (
                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                    Keeps running if you refresh or come back later. Stop ends it and returns to setup; a bet already placed still settles.
                  </p>
                ) : null}
              </>
            ) : (
              /* ---- Config ---- */
              <>
                {/* Direction */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(['UP', 'DOWN'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDirection(d)}
                      className={cn(
                        'flex h-10 items-center justify-center gap-1.5 rounded-lg border font-mono text-xs uppercase tracking-wider transition-colors',
                        direction === d
                          ? d === 'UP'
                            ? 'border-positive/50 bg-positive/15 text-positive'
                            : 'border-negative/50 bg-negative/15 text-negative'
                          : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35]',
                      )}
                    >
                      {d === 'UP' ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
                      {d === 'UP' ? 'Higher' : 'Lower'}
                    </button>
                  ))}
                </div>

                {/* Risk tier — picks the per-round odds, strike re-solved each round */}
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Risk per round</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RISK_TIERS.map((t) => {
                      const o = tierOdds(market, direction, t.target);
                      const active = t.id === tierId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTierId(t.id)}
                          className={cn(
                            'flex flex-col items-center gap-0.5 rounded-lg border py-2 transition-colors',
                            active
                              ? 'border-primary/50 bg-primary/15 text-foreground'
                              : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35] hover:text-foreground',
                          )}
                        >
                          <span className="text-xs font-medium uppercase tracking-wider">{t.label}</span>
                          <span className="font-mono text-sm font-semibold tabular-nums">{o.mult.toFixed(2)}×</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">{formatPct(o.pWin * 100, false)} win</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{tier.label}: {tier.blurb}. Strike auto-set each round to keep these odds.</p>
                </div>

                {/* Stake per round */}
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Stake per round</label>
                  <Input inputMode="decimal" value={cfg.baseStake} onChange={(e) => set({ baseStake: e.target.value.replace(/[^0-9.]/g, '') })} />
                  <div className="grid grid-cols-3 gap-1.5">
                    {STAKE_PRESETS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => set({ baseStake: String(a) })}
                        className="h-7 rounded-md border border-white/10 bg-[#17191e] text-xs text-muted-foreground hover:bg-[#2b2e35] hover:text-foreground"
                      >
                        ${a}
                      </button>
                    ))}
                  </div>
                </div>

                {/* On loss */}
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">On loss</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => set({ onLoss: 'reset' })}
                      className={cn(
                        'h-9 rounded-lg border text-xs',
                        cfg.onLoss === 'reset' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35]',
                      )}
                    >
                      Reset to base
                    </button>
                    <div
                      className={cn(
                        'flex h-9 items-center gap-1 rounded-lg border px-2 text-xs',
                        cfg.onLoss === 'increase' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-white/10 bg-[#17191e] text-muted-foreground',
                      )}
                    >
                      <button type="button" onClick={() => set({ onLoss: 'increase' })} className="whitespace-nowrap">
                        Increase
                      </button>
                      <input
                        inputMode="decimal"
                        value={cfg.increasePct}
                        onChange={(e) => set({ onLoss: 'increase', increasePct: e.target.value.replace(/[^0-9]/g, '') })}
                        className="w-10 bg-transparent text-right tabular-nums focus:outline-none"
                      />
                      <span>%</span>
                    </div>
                  </div>
                </div>

                {/* Stops */}
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Stop when any one hits</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <StopField label="Rounds" value={cfg.maxRounds} onChange={(v) => set({ maxRounds: v })} />
                    <StopField label="Stop-loss $" value={cfg.stopLoss} onChange={(v) => set({ stopLoss: v })} />
                    <StopField label="Take-profit $" value={cfg.takeProfit} onChange={(v) => set({ takeProfit: v })} />
                  </div>
                </div>

                {/* Risk + odds disclosure */}
                <div className="space-y-1.5 rounded-lg border border-white/10 bg-[#0d0f14] p-3 text-sm">
                  <Row label="Per-round odds" value={`${mult.toFixed(2)}× · ${formatPct(pWin * 100, false)} to win`} />
                  <Row label="Max at risk" value={formatUsd(maxAtRisk)} valueClass="text-base font-semibold" />
                  <p className="pt-1 text-xs text-muted-foreground">
                    Auto-bet can lose your full max-at-risk. The stop-loss and round cap keep it bounded.
                  </p>
                </div>

                <Button
                  size="lg"
                  className="w-full bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-mono text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] hover:brightness-110"
                  disabled={!account || config.baseStakeUsd <= 0 || config.stopLossUsd === null}
                  onClick={() => start(config)}
                >
                  {account ? 'Start Auto-Bet' : 'Sign in to auto-bet'}
                </Button>
                {config.stopLossUsd === null ? (
                  <p className="text-center text-xs text-warning">Set a stop-loss to start (required).</p>
                ) : null}
                <FaucetButton />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StopField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className="h-9 w-full rounded-lg border border-white/10 bg-[#17191e] px-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

/** 1s ticking clock, scoped to the component that needs a live countdown. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Compact recap of the running config, so the bettor always sees what they set. */
function RunSummary({
  cfg,
  tierLabel,
  odds,
}: {
  cfg: AutoBetConfig;
  tierLabel: string;
  odds: { pWin: number; mult: number } | null;
}) {
  const up = cfg.direction === 'UP';
  const params: { label: string; value: string }[] = [
    { label: 'Base stake', value: formatUsd(cfg.baseStakeUsd) },
    { label: 'On loss', value: cfg.onLoss === 'increase' ? `Raise +${cfg.increasePct}%` : 'Reset to base' },
    { label: 'Max rounds', value: String(cfg.maxRounds) },
    { label: 'Stop-loss', value: cfg.stopLossUsd != null ? formatUsd(cfg.stopLossUsd) : 'None' },
  ];
  if (cfg.takeProfitUsd != null) params.push({ label: 'Take-profit', value: formatUsd(cfg.takeProfitUsd) });
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2.5 rounded-xl border border-white/10 bg-[#0d0f14] p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold',
            up ? 'border-positive/40 bg-positive/10 text-positive' : 'border-negative/40 bg-negative/10 text-negative',
          )}
        >
          {up ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
          {up ? 'Higher' : 'Lower'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          {tierLabel}
          {odds ? <span className="font-mono tabular-nums text-primary/70">{odds.mult.toFixed(2)}×</span> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/5 pt-2.5">
        {params.map((p) => (
          <div key={p.label} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{p.label}</span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">{p.value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/** The in-flight bet with a live mm:ss countdown to settlement. */
function CurrentBetCard({ bet, expiry }: { bet: RoundLog; expiry: number | null }) {
  const now = useNow();
  const remaining = expiry != null ? Math.max(0, expiry - now) : null;
  const settling = remaining === 0;
  const level = remaining == null || remaining >= 90_000 ? 'green' : remaining >= 30_000 ? 'amber' : 'red';
  const up = bet.direction === 'UP';
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-b from-primary/[0.12] to-primary/[0.03] p-3.5">
      {/* live shimmer sweep — conveys an open position in play */}
      <motion.div
        className="pointer-events-none absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
        animate={{ x: ['-120%', '320%'] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary/80">
            <span className="relative inline-flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            Live bet · Round {bet.round}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-base font-semibold">
            {up ? <ArrowUp className="size-4 text-positive" /> : <ArrowDown className="size-4 text-negative" />}
            {up ? 'Higher' : 'Lower'} {formatUsd(bet.strike, 0)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {formatUsd(bet.stake)} stake · to win{' '}
            <span className="font-medium text-positive">{formatUsd(bet.payout)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              'inline-flex items-center gap-1 font-mono text-2xl font-semibold tabular-nums transition-colors',
              settling && 'animate-pulse',
              level === 'green' && 'text-foreground',
              level === 'amber' && 'text-warning',
              level === 'red' && 'text-negative',
            )}
          >
            <Timer className="size-4" />
            {remaining == null ? '--:--' : settling ? '0:00' : mmss(remaining)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {settling ? 'Settling now' : 'to settle'}
          </div>
        </div>
      </div>
    </div>
  );
}
