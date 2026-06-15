'use client';

import { Suspense, useEffect, useState } from 'react';
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
import { MarketCard } from '@/components/trade/market-card';
import { ExpiryTabs } from '@/components/trade/expiry-tabs';
import { QuickBetPanel, RANGE_STEP, type Tab } from '@/components/trade/quick-bet-panel';
import { ActiveBetsCard } from '@/components/trade/active-bets-card';
import { useLiveMarkets } from '@/lib/hooks';
import type { LiveMarket } from '@/lib/types';
import { formatPct, formatUsd } from '@/lib/format';
import { binaryUpProbability, probabilityToOdds, rangeProbability } from '@/lib/svi';
import { cn } from '@/lib/utils';

const baseSymbol = (pair: string) => pair.split('/')[0];

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

  // User's explicit pick wins; otherwise the `?m=` deep link (from the global
  // search); otherwise the nearest market that isn't in its final pre-expiry
  // freeze window, so the panel auto-rolls to the next expiry instead of
  // parking on a closing market.
  const requested = oracleId ?? searchParams.get('m') ?? undefined;
  const market =
    markets.data?.find((m) => m.oracleId === requested) ??
    markets.data?.find((m) => m.expiry - Date.now() > 30_000) ??
    markets.data?.[0];

  // Seed the strike at the current price; reseed when the market rolls over.
  const activeOracle = market?.oracleId;
  useEffect(() => {
    if (!market) return;
    // Start the strike exactly on the current BTC price (snapped to the tick grid).
    setStrikeText(String(Math.round(market.spot / market.tickSize) * market.tickSize));
    setBand(defaultBand(market));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOracle]);

  // Re-seed the Range band with a fresh, good-looking default each time the
  // Range tab is entered (centered on the live price, scaled to volatility).
  useEffect(() => {
    if (tab !== 'RANGE' || !market) return;
    setBand(defaultBand(market));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeOracle]);

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
    <div className="space-y-6">
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <ExpiryTabs markets={assetMarkets} value={market?.oracleId} onSelect={setOracleId} />
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
          </CardHeader>
          <CardContent>
            {market ? (
              <PredictionChart
                spots={market.sparkline}
                times={market.sparkTimes}
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
              />
            ) : (
              <Skeleton className="h-[420px] w-full" />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Live Prediction Markets — Sui Testnet
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {markets.data
            ? markets.data.map((m) => (
                <MarketCard key={m.oracleId} market={m} onSelect={setOracleId} />
              ))
            : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </section>
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
