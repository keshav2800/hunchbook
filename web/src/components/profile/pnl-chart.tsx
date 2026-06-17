'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { formatUsd } from '@/lib/format';
import type { PnlSeries } from '@/lib/pnl';

const fmtDate = (t: number) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });

/** Clean gradient area of cumulative P/L — colour follows the sign of the total. */
export function PnlChart({ series, positive }: { series: PnlSeries; positive: boolean }) {
  const color = positive ? 'var(--positive)' : 'var(--negative)';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series.points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Headroom so a flat-at-zero line doesn't glue to the bottom edge. */}
        <YAxis hide domain={['dataMin', 'dataMax']} padding={{ top: 8, bottom: 8 }} />
        <Tooltip
          cursor={{ stroke: 'var(--border)' }}
          contentStyle={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--foreground)',
            fontSize: 12,
          }}
          labelFormatter={(_, p) => (p?.[0] ? fmtDate(Number(p[0].payload.t)) : '')}
          formatter={(value) => [formatUsd(Number(value)), 'P/L']}
        />
        <Area
          dataKey="pnl"
          type="monotone"
          stroke={color}
          strokeWidth={2}
          fill="url(#pnlFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
