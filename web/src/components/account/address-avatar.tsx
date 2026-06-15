import { cn } from '@/lib/utils';

/** Two-hue gradient derived deterministically from the address bytes. */
function hues(address: string): [number, number] {
  let h = 0;
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return [h % 360, (h >> 9) % 360];
}

export function AddressAvatar({ address, className }: { address: string; className?: string }) {
  const [a, b] = hues(address);
  return (
    <span
      aria-hidden
      className={cn('inline-block size-8 shrink-0 rounded-full', className)}
      style={{ background: `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 45%))` }}
    />
  );
}
