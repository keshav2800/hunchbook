'use client';

import { toast } from 'sonner';
import { X } from 'lucide-react';
import { formatUsd } from '@/lib/format';
import type { Direction } from '@/lib/types';

/*
 * DeepBook-Predict-style purchase confirmation: dark green panel, mint text,
 * square dismiss button. Rendered through sonner's toast.custom so it gets
 * the stack's slide-in/swipe-out animations.
 */
type ToastArgs = { stakeUsd: number } & (
  | { direction: Direction; strikeUsd: number; range?: undefined }
  | { range: { lowerUsd: number; upperUsd: number }; direction?: undefined; strikeUsd?: undefined }
);

export function showBetSuccessToast(args: ToastArgs) {
  const { stakeUsd } = args;
  const side = args.range ? 'Range' : args.direction === 'UP' ? 'Above' : 'Below';
  const strike = args.range
    ? `${formatUsd(args.range.lowerUsd, 0)}-${formatUsd(args.range.upperUsd, 0)}`
    : `${formatUsd(args.strikeUsd, 0)}${args.direction === 'UP' ? '+' : '-'}`;
  toast.custom(
    (t) => (
      <div className="flex w-[356px] items-start gap-3 rounded-xl bg-[#1e3a31] p-4 shadow-2xl ring-1 ring-white/10">
        <p className="flex-1 text-base font-medium leading-snug text-[#8be8c6]">
          You successfully bought a new {side} position {strike} at {formatUsd(stakeUsd)}
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(t)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-[#8be8c6] transition-colors hover:bg-white/20"
        >
          <X className="size-4" />
        </button>
      </div>
    ),
    { duration: 6000 },
  );
}
