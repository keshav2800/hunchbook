'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Bitcoin, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PredictionChart } from '@/components/charts/prediction-chart';
import { MarketsBoard, type BoardPick } from '@/components/trade/markets-board';
import { ExpiryTabs } from '@/components/trade/expiry-tabs';
import { QuickBetPanel, RANGE_STEP, type Tab } from '@/components/trade/quick-bet-panel';
import { ActiveBetsCard } from '@/components/trade/active-bets-card';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useLiveMarkets, useOraclePrices } from '@/lib/hooks';
import type { LiveMarket } from '@/lib/types';
import { formatPct, formatUsd } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds, rangeProbability } from '@/lib/svi';
import { cn } from '@/lib/utils';

const baseSymbol = (pair: string) => pair.split('/')[0];

// `lg` (1024px) is where the Quick Bet panel docks beside the chart. Below it
// the panel moves into a bottom sheet, so we gate the sheet's open-on-pick
// behaviour on this. The fixed mobile bar is hidden by CSS (`lg:hidden`), so
// the SSR-false initial value never flashes a stray bar on desktop.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isDesktop;
}

function AssetIcon({ symbol }: { symbol: string }) {
  if (symbol === 'BTC') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-[#f7931a]">
        <Bitcoin className="size-3.5 text-white" />
      </span>
    );
  }
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
      {symbol.slice(0, 1)}
    </span>
  );
}

// How much price history the chart shows on the x-axis (independent of the bet's
// expiry) — a short window looks flat because BTC barely moves in a minute.
const CHART_RANGES = [
  { m: 5, label: '5m' },
  { m: 15, label: '15m' },
  { m: 60, label: '1h' },
] as const;

function ChartRangeTabs({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-white/5 bg-[#17191e]/95 p-0.5">
      {CHART_RANGES.map((r) => (
        <button
          key={r.m}
          type="button"
          onClick={() => onChange(r.m)}
          className={cn(
            'rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
            value === r.m ? 'bg-[#2b2e35] text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** A sensible Range band: centered on spot, width scaled to recent volatility,
 *  snapped to the ladder grid so the bound handles land on rows. */
function defaultBand(market: LiveMarket): { low: number; high: number } {
  const step = RANGE_STEP;
  const spark = market.sparkline;
  const hi = spark.length ? Math.max(...spark) : market.spot;
  const lo = spark.length ? Math.min(...spark) : market.spot;
  const vol = hi > lo ? hi - lo : step * 2;
  const half = Math.max(Math.round((vol * 0.3) / step) * step, step);
  const center = Math.round(market.spot / step) * step;
  const floor = Math.ceil(Math.max(market.minStrike, step) / step) * step;
  return { low: Math.max(center - half, floor), high: center + half };
}

function TradePageInner() {
  const markets = useLiveMarkets();
  const searchParams = useSearchParams();
  const [oracleId, setOracleId] = useState<string>();
  // Shared bet selection — owned here so the chart, ladder, and bet panel all
  // read/write one strike/direction/band.
  const [tab, setTab] = useState<Tab>('ABOVE');
  const [strikeText, setStrikeText] = useState('');
  const [band, setBand] = useState({ low: 0, high: 0 });
  const [chartMinutes, setChartMinutes] = useState(15);
  // Mobile bottom-sheet (bet panel) open state.
  const [betOpen, setBetOpen] = useState(false);
  const isDesktop = useIsDesktop();

  // User's explicit pick wins; otherwise the `?m=` deep link (from the global
  // search); otherwise the nearest market that isn't in its final pre-expiry
  // freeze window, so the panel auto-rolls to the next expiry instead of
  // parking on a closing market.
  const requested = oracleId ?? searchParams.get('m') ?? undefined;
  const market =
    markets.data?.find((m) => m.oracleId === requested) ??
    markets.data?.find((m) => m.expiry - Date.now() > 30_000) ??
    markets.data?.[0];

  // Longer price history for the chart's x-axis (the market's own sparkline is
  // only ~3 min, which looks flat). Falls back to the sparkline until it loads.
  const prices = useOraclePrices(market?.oracleId, chartMinutes);
  const chartSpots = prices.data && prices.data.spots.length > 1 ? prices.data.spots : market?.sparkline ?? [];
  const chartTimes = prices.data && prices.data.times.length > 1 ? prices.data.times : market?.sparkTimes ?? [];

  // Seed the strike at the current price; reseed when the market rolls over.
  const activeOracle = market?.oracleId;
  // A board pick loads an explicit strike/band; skip the auto-reseed for that
  // oracle so the defaults don't overwrite what the user just tapped.
  const pickRef = useRef<string | null>(null);
  useEffect(() => {
    if (!market) return;
    if (pickRef.current === market.oracleId) return;
    // Start the strike exactly on the current BTC price (snapped to the tick grid).
    setStrikeText(String(Math.round(market.spot / market.tickSize) * market.tickSize));
    setBand(defaultBand(market));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOracle]);

  // Re-seed the Range band with a fresh, good-looking default each time the
  // Range tab is entered (centered on the live price, scaled to volatility).
  useEffect(() => {
    if (tab !== 'RANGE' || !market) return;
    if (pickRef.current === market.oracleId) return;
    setBand(defaultBand(market));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeOracle]);

  // One-tap from the Markets board → load that exact bet into the chart + panel.
  const handlePick = (p: BoardPick) => {
    pickRef.current = p.oracleId;
    setOracleId(p.oracleId);
    setTab(p.tab);
    if (p.tab === 'RANGE') setBand(p.band);
    else setStrikeText(String(p.strike));
    // On mobile the panel lives in a sheet — surface it so the pick is
    // immediately actionable instead of silently loading off-screen.
    if (!isDesktop) setBetOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Release after effects settle so future manual switches reseed normally.
    setTimeout(() => {
      pickRef.current = null;
    }, 0);
  };

  const allMarkets = markets.data ?? [];
  const assets = Array.from(new Set(allMarkets.map((m) => m.pair)));
  const assetMarkets = allMarkets.filter((m) => m.pair === market?.pair);
  const pickAsset = (pair: string) => {
    const first = allMarkets.find((m) => m.pair === pair);
    if (first) setOracleId(first.oracleId);
  };

  // Contract-price (¢) readout — same SVI math the bet panel uses.
  const strikeNum = Number(strikeText) || 0;
  const direction: 'UP' | 'DOWN' = tab === 'BELOW' ? 'DOWN' : 'UP';
  const isRange = tab === 'RANGE';
  const pUp = market?.svi ? binaryUpProbability(market.forward, strikeNum, market.svi) : 0.5;
  const pRange = market?.svi ? rangeProbability(market.forward, band.low, band.high, market.svi) : 0;
  const pWin = isRange ? pRange : direction === 'UP' ? pUp : 1 - pUp;
  const mult = pWin > 0 ? probabilityToOdds(pWin) : 0;
  const cents = mult > 0 ? Math.round(100 / mult) : null;

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      {markets.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <TriangleAlert className="size-4 shrink-0" />
          Testnet data unavailable: {markets.error.message}
        </div>
      ) : null}

      {/* Asset header pill */}
      {market ? (
        <Select value={market.pair} onValueChange={pickAsset}>
          <SelectTrigger className="h-auto rounded-full border-white/10 bg-[#17191e] py-1.5 pr-2.5 pl-1.5 hover:bg-[#2b2e35]">
            <span className="flex items-center gap-2">
              <AssetIcon symbol={baseSymbol(market.pair)} />
              <span className="font-semibold">{baseSymbol(market.pair)}</span>
              <span className="h-3.5 w-px bg-white/15" />
              <span className="font-semibold tabular-nums">{formatUsd(market.spot)}</span>
              <span
                className={cn(
                  'text-sm font-medium tabular-nums',
                  market.sessionChangePct >= 0 ? 'text-positive' : 'text-negative',
                )}
              >
                {formatPct(market.sessionChangePct)}
              </span>
            </span>
          </SelectTrigger>
          <SelectContent>
            {assets.map((pair) => (
              <SelectItem key={pair} value={pair}>
                {baseSymbol(pair)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Skeleton className="h-10 w-48 rounded-full" />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <ExpiryTabs markets={assetMarkets} value={market?.oracleId} onSelect={setOracleId} />
            <div className="flex items-center gap-3">
              <ChartRangeTabs value={chartMinutes} onChange={setChartMinutes} />
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {cents != null ? `${cents}¢` : '—'}
                </span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Contract
                </span>
                {mult > 0 ? (
                  <span className="text-sm font-medium text-positive">{mult.toFixed(2)}×</span>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {market ? (
              <PredictionChart
                spots={chartSpots}
                times={chartTimes}
                mode={isRange ? 'range' : 'single'}
                strike={strikeNum}
                direction={direction}
                lower={band.low}
                upper={band.high}
                tickSize={market.tickSize}
                minStrike={market.minStrike}
                label={market.pair}
                onStrikeChange={(p) => setStrikeText(String(p))}
                onRangeChange={(low, high) => setBand({ low, high })}
                className="h-full min-h-[420px]"
              />
            ) : (
              <Skeleton className="h-full min-h-[420px] w-full" />
            )}
          </CardContent>
        </Card>

        {/* Docked panel — beside the chart on lg+ (small laptops / big tablets). */}
        <div className="hidden space-y-6 lg:block">
          <QuickBetPanel
            market={market}
            tab={tab}
            onTabChange={setTab}
            strikeText={strikeText}
            onStrikeTextChange={setStrikeText}
            band={band}
            onBandChange={setBand}
          />
          <ActiveBetsCard markets={markets.data} />
        </div>
      </div>

      {/* On mobile the bet panel moves into the bottom sheet, so active bets
          take the full width here instead. */}
      <div className="lg:hidden">
        <ActiveBetsCard markets={markets.data} />
      </div>

      <MarketsBoard markets={assetMarkets} defaultOracleId={market?.oracleId} onPick={handlePick} />

      {/* Mobile bet bar — fixed to the bottom, opens the Quick Bet sheet. */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 px-4 pt-3 lg:hidden"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <button
          type="button"
          onClick={() => setBetOpen(true)}
          disabled={!market}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-mono text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] transition hover:brightness-110 disabled:opacity-50"
        >
          Place a bet
          {cents != null ? (
            <span className="font-sans tracking-normal text-white/80">· {cents}¢</span>
          ) : null}
        </button>
      </div>

      {/* Apple-style bottom sheet holding the full Quick Bet panel. */}
      <Sheet open={betOpen} onOpenChange={setBetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[90vh] overflow-y-auto rounded-t-2xl border-white/10 bg-card px-4 pt-3 ring-1 ring-white/10"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        >
          <SheetTitle className="sr-only">Quick Bet</SheetTitle>
          <div className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-white/15" />
          <QuickBetPanel
            bare
            market={market}
            tab={tab}
            onTabChange={setTab}
            strikeText={strikeText}
            onStrikeTextChange={setStrikeText}
            band={band}
            onBandChange={setBand}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense>
      <TradePageInner />
    </Suspense>
  );
}
