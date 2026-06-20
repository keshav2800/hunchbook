'use client';

import { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Stake-style session equity curve: the running cumulative P&L of an auto-bet
 * run, drawn as a soft area + line that extends as each round settles. Colour
 * tracks the sign of the latest P&L (green in profit, red underwater).
 *
 * `points` is the cumulative-P&L series including the leading 0, e.g.
 * [0, +24, -1, +23, ...].
 */
export function EquityCurve({ points, className }: { points: number[]; className?: string }) {
  const gradId = useId();
  const W = 320;
  const H = 96;
  const PAD = 8;

  const series = points.length >= 2 ? points : [0, 0];
  const up = series[series.length - 1] >= 0;
  const color = up ? 'var(--positive)' : 'var(--negative)';

  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const zeroY = y(0);

  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(series.length - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;

  const lastX = x(series.length - 1);
  const lastY = y(series[series.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('h-24 w-full overflow-visible', className)}
      role="img"
      aria-label="Session profit curve"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* break-even baseline */}
      <line
        x1={PAD}
        x2={W - PAD}
        y1={zeroY}
        y2={zeroY}
        stroke="currentColor"
        className="text-white/10"
        strokeDasharray="3 4"
        strokeWidth={1}
      />

      {/* area fill */}
      <motion.path
        d={area}
        fill={`url(#${gradId})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      />

      {/* the curve, re-drawn with a quick extend on each new point */}
      <motion.path
        key={series.length}
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0.85, opacity: 0.6 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />

      {/* glowing live head */}
      <motion.circle
        cx={lastX}
        cy={lastY}
        r={6}
        fill={color}
        opacity={0.25}
        animate={{ r: [6, 11, 6], opacity: [0.25, 0, 0.25] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
      />
      <circle cx={lastX} cy={lastY} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}
