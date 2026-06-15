'use client';

import { Flame, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StreakInfo } from '@/lib/types';

export function StreakCounter({ streak }: { streak: StreakInfo }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Streak Counter</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          {streak.milestones.map((days) => {
            const unlocked = streak.currentDays >= days;
            const isCurrent =
              unlocked &&
              days === Math.max(...streak.milestones.filter((m) => m <= streak.currentDays));
            return (
              <div key={days} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={cn(
                    'flex size-16 items-center justify-center rounded-full border-2',
                    unlocked
                      ? 'border-ring bg-accent text-accent-foreground'
                      : 'border-border bg-muted text-muted-foreground',
                    isCurrent && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  {unlocked ? <Flame className="size-6" /> : <Lock className="size-5" />}
                </div>
                <span className="text-sm font-medium">{days} Day</span>
                <span className="text-xs text-muted-foreground">
                  {unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Current streak:{' '}
          <span className="font-medium text-foreground">{streak.currentDays} days</span> — keep
          predicting daily to unlock higher rewards.
        </p>
      </CardContent>
    </Card>
  );
}
