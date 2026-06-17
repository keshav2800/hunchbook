'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Dock glyphs, DeepBook-style: flat and solid, no gradients. One cohesive
 * family on a 24-grid — a single off-white ink used as both a 2px stroke and a
 * solid fill, so each icon reads as a crisp, bold mark on the dock's dark glass.
 */
const INK = '#eef4ff';

function Glyph({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('h-full w-full', className)}>
      <g stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

/** Trade — twin candlesticks (solid bodies). */
export function TradeIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <line x1="8" y1="3.5" x2="8" y2="20.5" />
      <rect x="5.6" y="7" width="4.8" height="8" rx="1.5" fill={INK} />
      <line x1="16" y1="6" x2="16" y2="18" />
      <rect x="13.6" y="9.5" width="4.8" height="6.5" rx="1.5" fill={INK} />
    </Glyph>
  );
}

/** My Bets — a perforated betting slip. */
export function BetsIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3" y="6.8" width="18" height="10.4" rx="2.4" />
      <line x1="14.6" y1="6.8" x2="14.6" y2="17.2" strokeDasharray="1.5 1.8" />
      <line x1="6.3" y1="10.6" x2="11.4" y2="10.6" />
      <line x1="6.3" y1="13.4" x2="9.9" y2="13.4" />
    </Glyph>
  );
}

/** Strike — a solid lightning bolt (auto-bet). */
export function StrikeIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M13 2.75 6 12.6 10.8 12.6 10.4 21.25 18 10.7 13.2 10.7Z" fill={INK} />
    </Glyph>
  );
}

/** Vault — a safe door with a combination dial. */
export function VaultIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="3" />
      <circle cx="10.6" cy="12" r="3.3" />
      <circle cx="10.6" cy="12" r="0.8" fill={INK} stroke="none" />
      <line x1="10.6" y1="8.7" x2="10.6" y2="7.5" />
      <line x1="10.6" y1="15.3" x2="10.6" y2="16.5" />
      <line x1="7.3" y1="12" x2="6.1" y2="12" />
      <line x1="17.4" y1="10.3" x2="17.4" y2="13.7" />
    </Glyph>
  );
}

/** Leaderboard — a trophy (solid cup + base). */
export function LeaderboardIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M7.6 4 H16.4 V7 C16.4 10.4 14.4 12.3 12 12.3 C9.6 12.3 7.6 10.4 7.6 7 Z" fill={INK} />
      <path d="M7.6 4.9 C5 4.9 4.7 8.8 7.8 8.9" />
      <path d="M16.4 4.9 C19 4.9 19.3 8.8 16.2 8.9" />
      <line x1="12" y1="12.3" x2="12" y2="15.6" />
      <path d="M10 15.6 H14 L14.8 19.6 H9.2 Z" fill={INK} />
    </Glyph>
  );
}
