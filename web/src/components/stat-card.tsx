import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  sub,
  subClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  subClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {sub ? <p className={cn('text-sm', subClassName)}>{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
