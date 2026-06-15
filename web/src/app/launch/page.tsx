'use client';

import { ArrowUpRight, ChartCandlestick, Coins, Rocket, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AddressAvatar } from '@/components/account/address-avatar';
import { cn } from '@/lib/utils';

const STEPS = [
  {
    icon: Rocket,
    title: '1 · Launch',
    body: 'Create your token in one click. Bonding-curve pricing from the first buyer — no liquidity to raise, no presale.',
  },
  {
    icon: ChartCandlestick,
    title: '2 · Predict',
    body: 'Every launch ships with its own prediction market. Your community bets UP or DOWN on your token’s price — the same engine that powers BTC markets here today.',
  },
  {
    icon: Coins,
    title: '3 · Earn',
    body: 'All that action flows through the house pool. LPs in the vault earn from every prediction placed on every launched token.',
  },
];

// Preview chips — deterministic gradient avatars, clearly marked as preview.
const PREVIEW_TOKENS = [
  { ticker: '$WAVE', addr: '0x77a1e5', change: '+182%' },
  { ticker: '$SUIDOG', addr: '0x9c41fb', change: '+64%' },
  { ticker: '$ORACLE', addr: '0x3d99a2', change: '+311%' },
  { ticker: '$FEED', addr: '0xb12c77', change: '+27%' },
];

export default function LaunchPage() {
  const notify = () =>
    toast('Launchpad is coming right after the hackathon — stay tuned! 🚀', {
      description: 'Launch your token, and let the market predict it.',
    });

  return (
    <div className="relative overflow-hidden">
      {/* ambient gradient orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/4 size-96 rounded-full opacity-25 blur-3xl"
        style={{ background: 'var(--chart-1)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-40 size-80 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--chart-2)' }}
      />

      <div className="relative mx-auto max-w-3xl space-y-10 py-10 text-center">
        <Badge className="mx-auto gap-1.5 rounded-full bg-accent px-3 py-1 text-accent-foreground">
          <Sparkles className="size-3.5" /> Coming soon
        </Badge>

        <div className="space-y-4">
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Launch your token.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--brand-gradient-text)' }}
            >
              Let the market predict it.
            </span>
          </h1>
          <p className="mx-auto max-w-xl text-balance text-muted-foreground">
            Today you can predict BTC. Next: anyone can launch a token here — and the moment it
            goes live, a prediction market opens on it. One flywheel: creators launch, the crowd
            predicts, LPs earn.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button size="lg" className="gap-2" onClick={notify}>
            <Rocket className="size-4" />
            Launch a token
            <ArrowUpRight className="size-4" />
          </Button>
          <Button size="lg" variant="outline" onClick={notify}>
            Notify me
          </Button>
        </div>

        {/* preview token strip */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Preview — what launches will look like
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {PREVIEW_TOKENS.map((t) => (
              <div
                key={t.ticker}
                className={cn(
                  'flex items-center gap-2 rounded-full border bg-card/60 py-1.5 pl-1.5 pr-3',
                  'transition-transform hover:-translate-y-0.5',
                )}
              >
                <AddressAvatar address={t.addr} className="size-6" />
                <span className="text-sm font-semibold">{t.ticker}</span>
                <span className="text-xs font-medium text-positive">{t.change}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 pt-2 text-left sm:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.title} className="bg-card/60 transition-colors hover:border-accent">
              <CardContent className="space-y-2 pt-6">
                <s.icon className="size-5 text-accent-foreground" />
                <p className="font-semibold">{s.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Markets on launched tokens will use time-weighted pricing with liquidity floors and
          position caps — manipulation-resistant by design.
        </p>
      </div>
    </div>
  );
}
