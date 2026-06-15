'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const color = positive ? 'var(--positive)' : 'var(--negative)';
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          dataKey="v"
          type="monotone"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.15}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
