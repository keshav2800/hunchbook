'use client';

import { ChevronDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Countdown } from '@/components/countdown';
import { cn } from '@/lib/utils';
import type { LiveMarket } from '@/lib/types';

const MAX_TABS = 3;

/** "TODAY 2PM" / "TMRW 8AM" / "JUN 16 2PM" — compact expiry label for a tab. */
export function expiryTabLabel(expiry: number): string {
  const d = new Date(expiry);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day =
    d.toDateString() === now.toDateString()
      ? 'TODAY'
      : d.toDateString() === tomorrow.toDateString()
        ? 'TMRW'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  const m = d.getMinutes();
  const time = m ? `${h}:${String(m).padStart(2, '0')}${ampm}` : `${h}${ampm}`;
  return `${day} ${time}`;
}

/*
 * Horizontal expiry selector that replaces the market dropdown. Each active
 * oracle becomes a tab (soonest first); the selected tab is a blue gradient
 * pill carrying a live countdown. Overflow markets fold into a MORE dropdown.
 */
export function ExpiryTabs({
  markets,
  value,
  onSelect,
}: {
  markets: LiveMarket[];
  value?: string;
  onSelect: (oracleId: string) => void;
}) {
  if (markets.length === 0) return null;

  // Keep the selected market visible even if it sits past the tab cutoff.
  const selectedIdx = markets.findIndex((m) => m.oracleId === value);
  const visible = markets.slice(0, MAX_TABS);
  if (selectedIdx >= MAX_TABS) visible[MAX_TABS - 1] = markets[selectedIdx];
  const overflow = markets.filter((m) => !visible.includes(m));

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Pills scroll horizontally; "More" stays pinned so it's always reachable. */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((m) => {
          const active = m.oracleId === value;
          return (
            <button
              key={m.oracleId}
              type="button"
              onClick={() => onSelect(m.oracleId)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 font-mono text-xs uppercase tracking-wider transition-colors',
                active
                  ? 'border-transparent bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]'
                  : 'border-white/10 bg-[#17191e] text-muted-foreground hover:bg-[#2b2e35] hover:text-foreground',
              )}
            >
              <span>{expiryTabLabel(m.expiry)}</span>
              {active ? (
                <Countdown
                  expiry={m.expiry}
                  className="border-transparent !bg-transparent px-0 py-0 text-white/90"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {overflow.length > 0 ? (
        <Select value={value ?? ''} onValueChange={onSelect}>
          <SelectTrigger className="h-9 shrink-0 gap-1 rounded-lg border-white/10 bg-[#17191e] font-mono text-xs uppercase tracking-wider text-muted-foreground hover:bg-[#2b2e35] [&>svg]:hidden">
            <span className="flex items-center gap-1">
              More <ChevronDown className="size-3.5" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {overflow.map((m) => (
              <SelectItem key={m.oracleId} value={m.oracleId}>
                {expiryTabLabel(m.expiry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
