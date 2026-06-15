import { Skeleton } from '@/components/ui/skeleton';

/** One labeled stat. `value === null` renders a loading skeleton. */
export function StatCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === null ? (
        <Skeleton className="mt-1 h-6 w-20" />
      ) : (
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}
