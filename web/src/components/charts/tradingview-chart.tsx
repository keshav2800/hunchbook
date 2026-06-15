'use client';

import { useEffect, useRef } from 'react';

export function TradingViewChart({
  symbol = 'BINANCE:BTCUSDT',
  className = 'h-[420px] w-full',
}: {
  symbol?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      autosize: true,
      interval: '60',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      hide_top_toolbar: false,
      hide_legend: true,
      allow_symbol_change: false,
      save_image: false,
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
    };
  }, [symbol]);

  return <div ref={containerRef} className={className} />;
}
