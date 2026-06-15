'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { expiryLabel } from '@/components/trade/market-card';
import { useLiveMarkets } from '@/lib/hooks';
import { formatPct, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Global market search. Client-side filter over the live markets feed;
 * selecting a market routes to the Trade page with `?m=<oracleId>`.
 */
export function MarketSearch({ className }: { className?: string }) {
  const router = useRouter();
  const markets = useLiveMarkets();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search field from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = useMemo(() => {
    if (!markets.data) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? markets.data.filter((m) => `${m.pair} ${expiryLabel(m)}`.toLowerCase().includes(q))
      : markets.data;
    return list.slice(0, 8);
  }, [markets.data, query]);

  const select = (oracleId: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    router.push(`/?m=${oracleId}`);
  };

  return (
    <div
      className={cn('relative', className)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) select(matches[0].oracleId);
          if (e.key === 'Escape') inputRef.current?.blur();
        }}
        placeholder="Search markets…"
        aria-label="Search markets"
        className="h-9 w-full rounded-full border border-white/10 bg-white/[0.05] pl-10 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/60"
      />
      <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] text-muted-foreground md:inline-block">
        ⌘K
      </kbd>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-popover p-1 shadow-2xl backdrop-blur-xl">
          {markets.isError ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Markets unavailable.</p>
          ) : !markets.data ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading markets…</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No markets match “{query}”.</p>
          ) : (
            matches.map((m) => (
              <button
                key={m.oracleId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(m.oracleId)}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left hover:bg-white/[0.06]"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{m.pair}</span>
                  <span className="text-xs text-muted-foreground">{expiryLabel(m)}</span>
                </span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-sm">{formatUsd(m.spot)}</span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      m.sessionChangePct >= 0 ? 'text-positive' : 'text-negative',
                    )}
                  >
                    {formatPct(m.sessionChangePct)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
