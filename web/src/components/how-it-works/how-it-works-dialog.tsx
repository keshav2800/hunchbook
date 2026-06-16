'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Bitcoin, ChevronLeft, Trophy, Waves } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Path = 'predict' | 'vault';
type Step = { title: string; line: string; art: ReactNode };

/* ---------- step illustrations (mini mockups of the real product) ---------- */

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(180deg,#0a1120_0%,#0a1c3a_100%)]">
      <div className="pointer-events-none absolute inset-x-0 bottom-[-50%] h-3/4 bg-[radial-gradient(55%_100%_at_50%_100%,rgba(77,162,255,0.28),transparent_70%)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

const CARD_SHADOW = 'shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)]';
const GRADIENT = 'bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset]';

// Confetti burst — replays whenever its step is shown (it remounts on nav).
const CONFETTI = [
  { x: '6%', c: '#4da2ff', d: 0 }, { x: '15%', c: '#10b981', d: 0.05 },
  { x: '24%', c: '#818cf8', d: 0.12 }, { x: '33%', c: '#f5a524', d: 0.02 },
  { x: '44%', c: '#4da2ff', d: 0.18 }, { x: '52%', c: '#10b981', d: 0.08 },
  { x: '61%', c: '#f43f5e', d: 0.14 }, { x: '69%', c: '#818cf8', d: 0.04 },
  { x: '78%', c: '#4da2ff', d: 0.1 }, { x: '86%', c: '#f5a524', d: 0.16 },
  { x: '94%', c: '#10b981', d: 0.06 }, { x: '38%', c: '#818cf8', d: 0.2 },
  { x: '57%', c: '#4da2ff', d: 0.22 }, { x: '12%', c: '#f5a524', d: 0.24 },
];
function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((p, i) => (
        <motion.span
          key={i}
          className="absolute top-1 size-1.5 rounded-[1px]"
          style={{ left: p.x, background: p.c }}
          initial={{ y: -10, opacity: 0, rotate: 0 }}
          animate={{ y: 168, opacity: [0, 1, 1, 0], rotate: 200 }}
          transition={{ duration: 1.4, delay: p.d, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

function PickArt() {
  const seg = 'rounded-md py-1 text-center font-mono text-[10px] uppercase tracking-wider';
  return (
    <Stage>
      <div className={cn('w-56 -rotate-2 rounded-xl border border-white/10 bg-[#0d1523] p-3', CARD_SHADOW)}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className="grid size-5 place-items-center rounded-full bg-[#f7931a]">
              <Bitcoin className="size-3 text-white" />
            </span>
            <span className="text-xs font-semibold">BTC</span>
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">$66,800</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <span className={cn(seg, GRADIENT, 'font-semibold text-white')}>Above</span>
          <span className={cn(seg, 'bg-[#17191e] text-muted-foreground')}>Range</span>
          <span className={cn(seg, 'bg-[#17191e] text-muted-foreground')}>Below</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between rounded-lg border border-white/10 bg-[#0b0f16] px-2.5 py-2">
          <span className="text-sm font-semibold tabular-nums">$66,800</span>
          <span className="text-sm font-semibold text-primary">+</span>
        </div>
      </div>
    </Stage>
  );
}

function BetArt() {
  return (
    <Stage>
      <div className={cn('w-52 rotate-2 rounded-xl border border-white/10 bg-[#0d1523] p-4 text-center', CARD_SHADOW)}>
        <div className="flex items-center justify-center gap-3">
          <span className="grid size-6 place-items-center rounded-md bg-[#17191e] text-muted-foreground">−</span>
          <span className="font-mono text-3xl font-semibold tabular-nums">$100</span>
          <span className="grid size-6 place-items-center rounded-md bg-[#17191e] text-muted-foreground">+</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          To win <span className="font-semibold text-positive">$172.00</span>
        </div>
        <div className={cn('mt-3 rounded-lg py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white', GRADIENT)}>
          Purchase position
        </div>
      </div>
    </Stage>
  );
}

function WinArt() {
  return (
    <Stage>
      <Confetti />
      <div className={cn('relative w-52 rounded-xl border border-positive/30 bg-[#0d1523] p-4 text-center', CARD_SHADOW)}>
        <span className="mx-auto mb-1.5 grid size-9 place-items-center rounded-full bg-positive/15">
          <Trophy className="size-5 text-positive" />
        </span>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">You won</div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-positive">+$172.00</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">settled to your balance</div>
      </div>
    </Stage>
  );
}

function Token({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className={cn('w-24 rounded-xl border bg-[#0d1523] p-3 text-center', CARD_SHADOW, accent ? 'border-primary/40' : 'border-white/10')}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</div>
      <div className={cn('text-[10px]', accent ? 'text-primary' : 'text-muted-foreground')}>{unit}</div>
    </div>
  );
}

function DepositArt() {
  return (
    <Stage>
      <div className="flex items-center gap-2.5">
        <Token label="Deposit" value="1,000" unit="dUSDC" />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <Token label="You receive" value="1,000" unit="pfShare" accent />
      </div>
    </Stage>
  );
}

function VaultArt() {
  return (
    <Stage>
      <div className={cn('w-52 rounded-xl border border-white/10 bg-[#0d1523] p-4', CARD_SHADOW)}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Vault APY</span>
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-foreground">
            The house
          </span>
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-positive">18.4%</div>
        <svg viewBox="0 0 200 44" preserveAspectRatio="none" className="mt-1 h-9 w-full">
          <defs>
            <linearGradient id="hb-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0,38 L33,34 L66,36 L99,26 L132,28 L165,16 L200,6" fill="none" stroke="#10b981" strokeWidth="2" />
          <path d="M0,38 L33,34 L66,36 L99,26 L132,28 L165,16 L200,6 L200,44 L0,44 Z" fill="url(#hb-spark)" />
        </svg>
      </div>
    </Stage>
  );
}

function CashoutArt() {
  return (
    <Stage>
      <Confetti />
      <div className={cn('relative w-52 rounded-xl border border-positive/30 bg-[#0d1523] p-4 text-center', CARD_SHADOW)}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Redeem 1,000 pfShare</div>
        <div className="font-mono text-2xl font-semibold tabular-nums text-positive">$1,084</div>
        <div className={cn('mt-3 rounded-lg py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white', GRADIENT)}>
          Withdraw
        </div>
      </div>
    </Stage>
  );
}

/* ------------------------------- flows ------------------------------------- */

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// DeepBook-style framed generative panel: neon motif glowing on near-black.
function ArtFrame({ accent, glowId, children }: { accent: string; glowId: string; children: ReactNode }) {
  return (
    <div
      className="relative h-24 overflow-hidden rounded-lg border"
      style={{ borderColor: hexA(accent, 0.45), background: '#05080e' }}
    >
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(85% 90% at 50% 115%, ${hexA(accent, 0.22)}, transparent 70%)` }}
      />
      <svg viewBox="0 0 252 96" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#${glowId})`}>{children}</g>
      </svg>
    </div>
  );
}

// Hand-tuned up-trend so it reads as a real BTC chart, not noise.
const CANDLES = [
  { x: 16, w1: 58, w2: 84, b1: 64, b2: 80, up: false },
  { x: 40, w1: 50, w2: 76, b1: 56, b2: 70, up: true },
  { x: 64, w1: 48, w2: 70, b1: 52, b2: 64, up: true },
  { x: 88, w1: 44, w2: 68, b1: 50, b2: 62, up: false },
  { x: 112, w1: 38, w2: 60, b1: 42, b2: 54, up: true },
  { x: 136, w1: 34, w2: 56, b1: 38, b2: 50, up: true },
  { x: 160, w1: 30, w2: 52, b1: 36, b2: 46, up: false },
  { x: 184, w1: 24, w2: 46, b1: 28, b2: 40, up: true },
  { x: 208, w1: 20, w2: 40, b1: 24, b2: 34, up: true },
  { x: 232, w1: 14, w2: 36, b1: 18, b2: 30, up: true },
];
function CandleArt() {
  return (
    <ArtFrame accent="#4da2ff" glowId="hbGlowAzure">
      {CANDLES.map((c, i) => (
        <g key={i} stroke="#4da2ff" fill="#4da2ff" opacity={c.up ? 0.95 : 0.4}>
          <line x1={c.x} x2={c.x} y1={c.w1} y2={c.w2} strokeWidth="1.4" />
          <rect x={c.x - 4} y={c.b1} width="8" height={c.b2 - c.b1} rx="1.2" />
        </g>
      ))}
    </ArtFrame>
  );
}

const BARS = [12, 36, 60, 84, 108, 132, 156, 180, 204, 228].map((x, i) => ({ x, y: 76 - i * 6.4 }));
function YieldArt() {
  return (
    <ArtFrame accent="#10b981" glowId="hbGlowEmerald">
      {BARS.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width="13" height={96 - b.y} rx="2" fill="#10b981" opacity={0.35 + i * 0.06} />
      ))}
      <polyline
        points={BARS.map((b) => `${b.x + 6.5},${b.y}`).join(' ')}
        fill="none"
        stroke="#5eead4"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </ArtFrame>
  );
}

type PathInfo = { id: Path; label: string; tagline: string; art: ReactNode };

const PATHS: PathInfo[] = [
  { id: 'predict', label: 'Predict', tagline: 'Bet on where Bitcoin goes next.', art: <CandleArt /> },
  { id: 'vault', label: 'Earn', tagline: 'Be the house and earn the edge.', art: <YieldArt /> },
];

// Each path carries its own colour identity: market azure vs yield emerald.
const ACCENTS: Record<Path, { glow: string; hoverBorder: string; hoverShadow: string; arrow: string }> = {
  predict: {
    glow: 'rgba(77,162,255,0.16)',
    hoverBorder: 'hover:border-primary/50',
    hoverShadow: 'hover:shadow-[0_16px_44px_-16px_rgba(77,162,255,0.5)]',
    arrow: 'group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary',
  },
  vault: {
    glow: 'rgba(16,185,129,0.14)',
    hoverBorder: 'hover:border-positive/50',
    hoverShadow: 'hover:shadow-[0_16px_44px_-16px_rgba(16,185,129,0.45)]',
    arrow: 'group-hover:border-positive/40 group-hover:bg-positive/10 group-hover:text-positive',
  },
};

function PathCard({ path, index, onSelect }: { path: PathInfo; index: number; onSelect: (id: Path) => void }) {
  const a = ACCENTS[path.id];
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(path.id)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + index * 0.07, duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d13] p-4 text-left transition-all duration-200 hover:-translate-y-0.5',
        a.hoverBorder,
        a.hoverShadow,
      )}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-16"
        style={{ background: `radial-gradient(80% 100% at 50% 0%, ${a.glow}, transparent)` }}
      />
      {path.art}
      <div className="relative flex items-end justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-base font-semibold tracking-tight text-foreground">{path.label}</div>
          <p className="text-sm text-muted-foreground">{path.tagline}</p>
        </div>
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground transition-all', a.arrow)}>
          <ArrowRight className="size-4" />
        </span>
      </div>
    </motion.button>
  );
}

const FLOWS: Record<Path, Step[]> = {
  predict: [
    { title: 'Pick your call', line: 'Will Bitcoin finish above, below, or in a range? You choose the price.', art: <PickArt /> },
    { title: 'Place your bet', line: 'Stake any amount and see your exact payout before you buy.', art: <BetArt /> },
    { title: 'Get paid', line: 'Win at expiry and your payout settles to your balance automatically.', art: <WinArt /> },
  ],
  vault: [
    { title: 'Deposit', line: 'Add dUSDC and receive pfShare, your tokenized stake in the pool.', art: <DepositArt /> },
    { title: 'The vault earns', line: 'It plays the house on every bet, fully hedged and run by a keeper.', art: <VaultArt /> },
    { title: 'Cash out', line: 'Your share compounds. Redeem pfShare for your slice anytime.', art: <CashoutArt /> },
  ],
};

const DEST: Record<Path, { href: string; cta: string }> = {
  predict: { href: '/', cta: 'Start predicting' },
  vault: { href: '/vault', cta: 'Open the Vault' },
};

const PRIMARY_CTA =
  'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] font-mono text-xs font-semibold uppercase tracking-[0.18em] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] transition hover:brightness-110';

/* ------------------------------- component --------------------------------- */

export function HowItWorks({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [path, setPath] = useState<Path | null>(null);
  const [step, setStep] = useState(0);

  // Reset to the chooser after the close animation, so it reopens fresh.
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setTimeout(() => { setPath(null); setStep(0); }, 160);
  };

  const steps = path ? FLOWS[path] : [];
  const isLast = step === steps.length - 1;
  const back = () => (step === 0 ? setPath(null) : setStep((s) => s - 1));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden sm:max-w-lg">
        {/* Stable a11y labels; visible copy below is plain text so it can animate. */}
        <DialogTitle className="sr-only">How Hunchbook works</DialogTitle>
        <DialogDescription className="sr-only">
          Choose to predict on markets or earn from the vault, then follow the steps.
        </DialogDescription>

        <AnimatePresence mode="wait" initial={false}>
          {path === null ? (
            <motion.div
              key="chooser"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-5"
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <span className={cn('flex size-11 items-center justify-center rounded-2xl text-white ring-4 ring-primary/15', GRADIENT)}>
                  <Waves className="size-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-mono text-xs uppercase tracking-wider text-primary/80">Welcome to Hunchbook</p>
                  <h2 className="text-lg font-semibold tracking-tight">How do you want to use it?</h2>
                  <p className="text-sm text-muted-foreground">
                    Pick what you’re here to do. You can switch anytime.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {PATHS.map((p, i) => (
                  <PathCard key={p.id} path={p} index={i} onSelect={(id) => { setPath(id); setStep(0); }} />
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="wizard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              <button
                type="button"
                onClick={back}
                className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
                Back
              </button>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="space-y-3"
                >
                  {steps[step].art}
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold tracking-tight text-foreground">
                      {step + 1}. {steps[step].title}
                    </h2>
                    <p className="text-sm text-muted-foreground">{steps[step].line}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="flex justify-center gap-1.5 pt-0.5">
                {steps.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === step ? 'w-5 bg-primary' : 'w-1.5 bg-white/15',
                    )}
                  />
                ))}
              </div>

              {isLast ? (
                <DialogClose asChild>
                  <Link href={DEST[path].href} className={PRIMARY_CTA}>
                    {DEST[path].cta}
                    <ArrowRight className="size-4" />
                  </Link>
                </DialogClose>
              ) : (
                <button type="button" onClick={() => setStep((s) => s + 1)} className={PRIMARY_CTA}>
                  Next
                  <ArrowRight className="size-4" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
