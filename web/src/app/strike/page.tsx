'use client';

import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { ArrowDown, ArrowUp, Bot, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PredictionChart } from '@/components/charts/prediction-chart';
import { FaucetButton } from '@/components/auth/faucet-button';
import { atmStrike } from '@/components/trade/quick-bet-panel';
import { useAutoBet, type AutoBetConfig, type OnLoss } from '@/lib/use-auto-bet';
import { useLiveMarkets } from '@/lib/hooks';
import { binaryUpProbability, probabilityToOdds } from '@/lib/svi';
import { formatNumber, formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Direction } from '@/lib/types';

const STAKE_PRESETS = [25, 100, 250] as const;

type Preset = { id: string; tag?: string; cfg: Partial<Config> };
type Config = {
  baseStake: string;
  onLoss: OnLoss;
  increasePct: string;
  maxRounds: string;
  stopLoss: string;
  takeProfit: string;
};

// One-tap strategies. STEADY is the safe default; PRESS is higher-variance.
const PRESETS: Preset[] = [
  { id: 'STEADY', cfg: { onLoss: 'reset', baseStake: '25', maxRounds: '10', stopLoss: '125', takeProfit: '' } },
  { id: 'STREAK', cfg: { onLoss: 'reset', baseStake: '25', maxRounds: '10', stopLoss: '75', takeProfit: '150' } },
  { id: 'PRESS', tag: 'higher variance', cfg: { onLoss: 'increase', increasePct: '50', baseStake: '25', maxRounds: '6', stopLoss: '520', takeProfit: '' } },
];

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

  const [direction, setDirection] = useState<Direction>('UP');
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

  const strike = atmStrike(market);
  const pUp = market.svi ? binaryUpProbability(market.forward, strike, market.svi) : 0.5;
  const pWin = direction === 'UP' ? pUp : 1 - pUp;
  const mult = market.svi ? probabilityToOdds(pWin) : 0;

  const config: AutoBetConfig = {
    direction,
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
  const dots = Array.from({ length: config.maxRounds });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bot className="size-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Auto Studio</h1>
        <span className="text-sm text-muted-foreground">— set a strategy, let it run</span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Chart */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>
              {market.pair} · auto {direction} @ {formatUsd(strike, 0)}
            </CardTitle>
            <span className="font-mono text-2xl font-semibold tabular-nums">{formatUsd(market.spot)}</span>
          </CardHeader>
          <CardContent>
            <PredictionChart
              spots={market.sparkline}
              times={market.sparkTimes}
              mode="single"
              strike={strike}
              direction={direction}
              lower={strike}
              upper={strike}
              tickSize={market.tickSize}
              minStrike={market.minStrike}
              label={market.pair}
            />
          </CardContent>
        </Card>

        {/* Auto panel */}
        <Card>
          <CardHeader>
            <CardTitle className="uppercase">{running ? 'Auto-Bet · Running' : done ? 'Auto-Bet · Complete' : 'Auto-Bet'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {running || done ? (
              /* ---- Cockpit ---- */
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Round {state.round} / {config.maxRounds}
                  </span>
                  {state.streak > 0 ? (
                    <span className="text-xs font-medium text-warning">🔥 {state.streak} win streak</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {dots.map((_, i) => {
                    const r = state.log.find((l) => l.round === i + 1);
                    return (
                      <span
                        key={i}
                        className={cn(
                          'h-2 flex-1 min-w-2 rounded-full',
                          r?.result === 'win' && 'bg-positive',
                          r?.result === 'loss' && 'bg-negative/60',
                          r?.result === 'error' && 'bg-warning/60',
                          !r && i + 1 === state.round + 1 && running && 'animate-pulse bg-primary',
                          !r && 'bg-white/10',
                        )}
                      />
                    );
                  })}
                </div>
                <div className="rounded-lg border border-white/10 bg-[#0d0f14] p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Session P&L</div>
                  <div
                    className={cn(
                      'font-mono text-3xl font-semibold tabular-nums',
                      state.sessionPnl > 0 ? 'text-positive' : state.sessionPnl < 0 ? 'text-negative' : 'text-foreground',
                    )}
                  >
                    {state.sessionPnl >= 0 ? '+' : ''}
                    {formatNumber(state.sessionPnl)}
                  </div>
                </div>
                {done && state.endedReason ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
                    {state.endedReason} · {state.log.filter((l) => l.result === 'win').length}W /{' '}
                    {state.log.filter((l) => l.result === 'loss').length}L
                  </div>
                ) : null}
                {state.log.length > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                    {state.log.map((l, i) => (
                      <div key={l.id ?? i} className="flex justify-between border-b border-white/5 py-1">
                        <span className="text-muted-foreground">R{l.round}</span>
                        <span
                          className={cn(
                            'font-medium uppercase',
                            l.result === 'win' && 'text-positive',
                            l.result === 'loss' && 'text-negative',
                            l.result === 'error' && 'text-warning',
                          )}
                        >
                          {l.result}
                        </span>
                        <span className="font-mono tabular-nums">
                          {l.pnl >= 0 ? '+' : ''}
                          {formatNumber(l.pnl)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {running ? (
                  <Button
                    size="lg"
                    className="w-full gap-2 bg-foreground font-semibold uppercase tracking-wider text-background hover:bg-foreground/90"
                    onClick={stop}
                  >
                    <Square className="size-4 fill-current" /> Stop now
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" className="w-full" onClick={reset}>
                    Run again
                  </Button>
                )}
                {running ? (
                  <p className="text-center text-xs text-muted-foreground">
                    Keep this tab open. Stopping won&apos;t recall a bet that&apos;s already placed.
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
                      {d === 'UP' ? 'Above' : 'Below'} {formatUsd(strike, 0)}
                    </button>
                  ))}
                </div>

                {/* Strategy presets */}
                <div className="grid grid-cols-3 gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set(p.cfg)}
                      className="flex flex-col items-center gap-0.5 rounded-lg border border-white/10 bg-[#17191e] py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-[#2b2e35] hover:text-foreground"
                    >
                      {p.id}
                      {p.tag ? <span className="text-[9px] normal-case text-warning">⚠ {p.tag}</span> : null}
                    </button>
                  ))}
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
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Stop when — any one hits</label>
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
                    Each round is slightly negative-EV after the 1% fee. Auto-bet can lose your full max-at-risk —
                    stop-loss and round cap keep it bounded.
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
