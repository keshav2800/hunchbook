'use client';

import { useEffect, useState } from 'react';
import { Bomb, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

const AMBER_BELOW_MS = 10 * 60_000; // < 10 min → amber
const RED_BELOW_MS = 3 * 60_000; // < 3 min → red + fuse-lit bomb

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Live countdown to expiry: green → amber (<10m) → pulsing red bomb (<3m). */
export function Countdown({ expiry, className }: { expiry: number; className?: string }) {
  const now = useNow();
  const ms = Math.max(0, expiry - now);

  if (ms === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
          className,
        )}
      >
        <Timer className="size-3.5" /> settling
      </span>
    );
  }

  const level = ms < RED_BELOW_MS ? 'red' : ms < AMBER_BELOW_MS ? 'amber' : 'green';
  const Icon = level === 'red' ? Bomb : Timer;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums transition-colors',
        level === 'green' && 'border-positive/40 bg-positive/10 text-positive',
        level === 'amber' && 'border-warning/40 bg-warning/10 text-warning',
        level === 'red' && 'animate-pulse border-negative/50 bg-negative/15 text-negative',
        className,
      )}
    >
      <Icon className={cn('size-3.5', level === 'red' && 'animate-bounce')} />
      {formatRemaining(ms)}
    </span>
  );
}
