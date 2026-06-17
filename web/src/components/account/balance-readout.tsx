import { Skeleton } from '@/components/ui/skeleton';

/** One Portfolio/Cash readout — `value === null` renders a loading skeleton. */
export function BalanceReadout({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
      {value === null ? (
        <Skeleton className="h-4 w-14" />
      ) : (
        <span className="text-sm font-semibold leading-tight tabular-nums text-positive">
          {value}
        </span>
      )}
    </div>
  );
}
