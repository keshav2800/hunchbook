'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactUsd } from '@/lib/format';
import type { VaultStats } from '@/lib/types';

export function NavChart({ history }: { history: VaultStats['history'] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="var(--muted-foreground)"
          tickLine={false}
          axisLine={false}
          minTickGap={48}
          fontSize={12}
        />
        <YAxis
          yAxisId="nav"
          orientation="right"
          stroke="var(--muted-foreground)"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompactUsd}
          width={70}
          fontSize={12}
        />
        <YAxis yAxisId="dd" hide domain={[-40, 0]} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--foreground)',
          }}
          formatter={(value, name) =>
            name === 'NAV'
              ? [formatCompactUsd(Number(value)), 'NAV']
              : [`${Number(value).toFixed(2)}%`, 'Drawdown']
          }
        />
        <Area
          yAxisId="nav"
          name="NAV"
          dataKey="nav"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#navFill)"
          isAnimationActive={false}
        />
        <Area
          yAxisId="dd"
          name="Drawdown"
          dataKey="drawdownPct"
          type="monotone"
          stroke="var(--chart-5)"
          strokeWidth={1.5}
          fill="var(--chart-5)"
          fillOpacity={0.08}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
