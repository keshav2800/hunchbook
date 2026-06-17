'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { usePlaceBet, useDusdcBalance } from '@/lib/use-place-bet';
import { FaucetButton } from '@/components/auth/faucet-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Countdown } from '@/components/countdown';
import { RangeLadder } from '@/components/trade/range-ladder';
import { RangeLadderHorizontal } from '@/components/trade/range-ladder-horizontal';
import { formatNumber, formatPct, formatUsd } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds, rangeProbability } from '@/lib/svi';
import type { LiveMarket } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Current spot rounded to $100 — the default "will BTC end above/below X" line. */
export function atmStrike(market: LiveMarket): number {
  return Math.round(market.spot / 100) * 100;
}

// The protocol freezes trading the instant a market expires (and during the
// expiry → settlement gap). Stop offering bets shortly before that wall so
// in-flight transactions can't land in the frozen window.
const CLOSING_BUFFER_MS = 20_000;

const STAKE_PRESETS = [25, 100, 250, 500] as const;

// Range ladder row spacing — multiple of the $1 oracle tick grid.
export const RANGE_STEP = 200;
// The band preselected when a market loads: spot ± this.
export const RANGE_DEFAULT_HALF = 200;

export type Tab = 'ABOVE' | 'RANGE' | 'BELOW';

function useNowTicking(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* DeepBook-Predict-style dark input box: $ prefix, free text, muted suffix.
   `display` is the pretty form (e.g. "75,250+") shown while not editing. */
function MoneyBox({
  value,
  onChange,
  suffix,
  ariaLabel,
  display,
  big = false,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  ariaLabel: string;
  display?: string;
  big?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-white/10 bg-[#0d0f14] px-3',
        big ? 'h-12' : 'h-11',
      )}
    >
      <span className={cn('text-muted-foreground', big ? 'text-lg' : 'text-sm')}>$</span>
      <input
        inputMode="decimal"
        aria-label={ariaLabel}
        value={focused ? value : (display ?? value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        className={cn(
          'w-full flex-1 bg-transparent text-foreground tabular-nums focus:outline-none',
          big ? 'text-lg font-semibold' : 'text-sm font-medium',
        )}
      />
      {suffix ? <span className={cn('text-muted-foreground', big ? 'text-lg' : 'text-sm')}>{suffix}</span> : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', valueClassName)}>{value}</span>
    </div>
  );
}

export function QuickBetPanel({
  market,
  tab,
  onTabChange,
  strikeText,
  onStrikeTextChange,
  band,
  onBandChange,
  bare = false,
}: {
  market?: LiveMarket;
  tab: Tab;
  onTabChange: (t: Tab) => void;
  strikeText: string;
  onStrikeTextChange: (v: string) => void;
  band: { low: number; high: number };
  onBandChange: (b: { low: number; high: number }) => void;
  // `bare` drops the Card chrome so the panel can live inside the mobile
  // bottom sheet, which supplies its own surface + header.
  bare?: boolean;
}) {
  const [stake, setStake] = useState('100');
  const [ctaHover, setCtaHover] = useState(false);
  const account = useCurrentAccount();
  const placeBet = usePlaceBet();
  const balance = useDusdcBalance();
  const now = useNowTicking();

  if (!market || strikeText === '') {
    const skeletons = (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
    if (bare) return skeletons;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quick Bet</CardTitle>
        </CardHeader>
        <CardContent>{skeletons}</CardContent>
      </Card>
    );
  }

  const strike = Number(strikeText) || 0;
  const direction = tab === 'BELOW' ? 'DOWN' : 'UP';
  const isRange = tab === 'RANGE';
  const pUp = market.svi ? binaryUpProbability(market.forward, strike, market.svi) : 0.5;
  const pRange = market.svi ? rangeProbability(market.forward, band.low, band.high, market.svi) : 0;
  const pWin = isRange ? pRange : direction === 'UP' ? pUp : 1 - pUp;
  const mult = pWin > 0 ? probabilityToOdds(pWin) : 0;
  const stakeNum = Number(stake) || 0;
  const closingSoon = market.expiry - now < CLOSING_BUFFER_MS;
  const contracts = stakeNum > 0 && mult > 0 ? stakeNum * mult : 0;
  // The protocol refuses to quote a range whose fair probability rounds to 0
  // or 1 at its 1e-9 fixed point (pricing_config aborts with code 1), so keep
  // a safety margin on both sides before letting the bet reach the chain.
  const rangeTooSure = isRange && pRange > 0.999;
  const rangeTooFar = isRange && pRange < 0.001;
  const rangeInvalid =
    isRange &&
    (band.high - band.low < RANGE_STEP ||
      band.low < market.minStrike ||
      rangeTooSure ||
      rangeTooFar);
  const expiryTime = new Date(market.expiry).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  const body = (
    <div className="space-y-4">
        {/* ABOVE / RANGE / BELOW segmented tabs */}
        <div className="grid grid-cols-3 gap-1.5">
          {(['ABOVE', 'RANGE', 'BELOW'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={cn(
                'h-9 rounded-lg border font-mono text-xs uppercase tracking-wider transition-colors',
                tab === t
                  ? 'border-transparent bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]'
                  : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35] hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="text-right text-xs text-muted-foreground">
            {mult > 0 ? `${Math.round(100 / mult)}¢ Contract Price` : '—'}
          </div>
          {isRange ? (
            <>
              {bare ? (
                <RangeLadderHorizontal
                  spot={market.spot}
                  step={RANGE_STEP}
                  minStrike={market.minStrike}
                  lower={band.low}
                  upper={band.high}
                  onChange={(low, high) => onBandChange({ low, high })}
                />
              ) : (
                <RangeLadder
                  spot={market.spot}
                  step={RANGE_STEP}
                  minStrike={market.minStrike}
                  lower={band.low}
                  upper={band.high}
                  onChange={(low, high) => onBandChange({ low, high })}
                />
              )}
              <p className="text-sm text-muted-foreground">
                Wins if BTC between {formatUsd(band.low, 0)} and {formatUsd(band.high, 0)} by{' '}
                {expiryTime}
              </p>
            </>
          ) : (
            <>
              <MoneyBox
                big
                value={strikeText}
                onChange={onStrikeTextChange}
                display={`${formatNumber(strike, 0)}${tab === 'ABOVE' ? '+' : '-'}`}
                suffix={tab === 'ABOVE' ? '∞' : '0'}
                ariaLabel="Strike price"
              />
              <p className="text-sm text-muted-foreground">
                Wins if BTC {tab === 'ABOVE' ? '>' : '<'} {formatUsd(strike, 0)} by {expiryTime}
              </p>
            </>
          )}
        </div>

        {/* Purchase (stake) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Purchase</span>
            <span className="text-xs text-muted-foreground">$ Size</span>
          </div>
          <MoneyBox value={stake} onChange={setStake} ariaLabel="Stake in dUSDC" />
          <div className="grid grid-cols-5 gap-1.5 pt-0.5">
            {STAKE_PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => setStake(String(amount))}
                className="h-7 rounded-md border border-white/10 bg-[#17191e] text-xs text-muted-foreground transition-colors hover:bg-[#2b2e35] hover:text-foreground"
              >
                ${amount}
              </button>
            ))}
            <button
              type="button"
              disabled={balance.data === undefined}
              onClick={() =>
                balance.data !== undefined && setStake(String(Math.floor(balance.data)))
              }
              className="h-7 rounded-md border border-white/10 bg-[#17191e] text-xs text-muted-foreground transition-colors hover:bg-[#2b2e35] hover:text-foreground disabled:opacity-50"
            >
              Max
            </button>
          </div>
        </div>

        {/* Order summary — bare rows on hairlines, like the reference */}
        <div className="divide-y divide-white/10">
          <SummaryRow label="Contracts" value={mult > 0 ? formatNumber(contracts) : '—'} />
          <SummaryRow label="Payout Multiple" value={mult > 0 ? `${mult.toFixed(2)}x` : '—'} />
          <SummaryRow
            label="Potential Payout"
            value={mult > 0 ? `+${formatUsd(stakeNum * mult)}` : '—'}
            valueClassName="text-base font-semibold text-positive"
          />
          <SummaryRow
            label="Win Probability"
            value={pWin > 0 ? formatPct(pWin * 100, false) : '—'}
          />
          <SummaryRow
            label="Betting on"
            value={
              isRange
                ? `BTC in ${formatUsd(band.low, 0)}–${formatUsd(band.high, 0)}`
                : `BTC ${direction === 'UP' ? '>' : '<'} ${formatUsd(strike, 0)}`
            }
          />
        </div>

        <div className="space-y-2">
          {/* CTA row: on hover (and while the bet is in flight) an arrow box
              slides in from the left, DeepBook-style, and the main button
              yields the space. */}
          <div className="flex h-11 w-full items-stretch gap-1">
            <AnimatePresence initial={false}>
              {(ctaHover || placeBet.isPending) && (
                <motion.div
                  key="arrow"
                  initial={{ width: 0, opacity: 0, x: -12 }}
                  animate={{ width: 44, opacity: 1, x: 0 }}
                  exit={{ width: 0, opacity: 0, x: -12 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                  className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]"
                >
                  <motion.span
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                  >
                    <ArrowRight className="size-4" />
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>
            <button
              type="button"
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
              className="h-full flex-1 rounded-lg bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-mono text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
              disabled={
                rangeInvalid ||
                !account ||
                placeBet.isPending ||
                stakeNum <= 0 ||
                (!isRange && strike < market.minStrike) ||
                closingSoon
              }
              onClick={() =>
                placeBet.mutate(
                  isRange
                    ? {
                        market,
                        range: { lowerUsd: band.low, upperUsd: band.high },
                        stakeUsd: stakeNum,
                        pWin,
                      }
                    : { market, direction, strikeUsd: strike, stakeUsd: stakeNum, pWin },
                )
              }
            >
              {closingSoon
                ? 'Market closing — pick the next expiry'
                : placeBet.isPending
                  ? 'Placing bet…'
                  : account
                    ? rangeTooSure
                      ? 'Band too wide — drag the handles closer'
                      : rangeTooFar
                        ? 'Band too far from price — move it closer'
                        : 'Purchase Position'
                    : 'Sign in to bet'}
            </button>
          </div>
          <FaucetButton />
        </div>
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-heading text-base font-medium uppercase text-foreground">
            Quick Bet
          </span>
          <Countdown
            expiry={market.expiry}
            className="rounded-lg border-white/10 bg-[#17191e] px-2.5 py-1.5"
          />
        </div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto] items-center">
        <CardTitle className="uppercase">Quick Bet</CardTitle>
        <Countdown
          expiry={market.expiry}
          className="rounded-lg border-white/10 bg-[#17191e] px-2.5 py-1.5"
        />
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
