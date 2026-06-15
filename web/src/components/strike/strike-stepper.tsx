'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function StrikeStepper({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  // Free-text while typing; clamp to the oracle minimum only on blur,
  // so entries like "70000" aren't mangled mid-keystroke.
  const [text, setText] = useState(String(value));

  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (n: number) => {
    const clamped = Math.max(min, n);
    onChange(clamped);
    setText(String(clamped));
  };

  return (
    <div className="space-y-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => commit(value - step)}>
          −{step.toLocaleString()}
        </Button>
        <Input
          inputMode="decimal"
          className="text-center font-mono"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const n = Number(raw);
            if (raw !== '' && !Number.isNaN(n)) onChange(n); // live re-pricing, no clamp yet
          }}
          onBlur={() => {
            const n = Number(text);
            if (text === '' || Number.isNaN(n)) {
              setText(String(value)); // restore last valid
            } else {
              commit(n);
            }
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => commit(value + step)}>
          +{step.toLocaleString()}
        </Button>
      </div>
    </div>
  );
}
