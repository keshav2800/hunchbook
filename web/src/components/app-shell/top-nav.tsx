'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { HelpCircle } from 'lucide-react';
import { motion } from 'motion/react';
import {
  Navbar,
  NavBody,
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
} from '@/components/ui/resizable-navbar';
import { AccountBar } from '@/components/account/account-bar';
import { MarketSearch } from '@/components/app-shell/market-search';
import { HowItWorks } from '@/components/how-it-works/how-it-works-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { name: 'Trade', link: '/' },
  { name: 'My Bets', link: '/bets' },
  { name: 'Strike', link: '/strike' },
  { name: 'Vault', link: '/vault' },
  { name: 'Leaderboard', link: '/leaderboard' },
  { name: 'Launch', link: '/launch', badge: 'Soon' },
];

function Brand() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2">
      <Image
        src="/hunchbook.png"
        alt="Hunchbook"
        width={40}
        height={40}
        priority
        className="size-10"
      />
      <span className="text-lg font-semibold tracking-tight">HunchBook</span>
    </Link>
  );
}

/* DeepBook-Predict-style segmented nav: links live inside a black box;
   the active tab is a lighter block that slides between routes. */
function NavTabs({ pathname }: { pathname: string }) {
  return (
    <nav className="hidden items-center gap-0.5 rounded-xl border border-white/5 bg-[#17191e]/95 p-1 lg:flex">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.link;
        return (
          <Link
            key={item.link}
            href={item.link}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId="active-tab"
                className="absolute inset-0 rounded-lg bg-[#2b2e35]"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <span className="relative z-10">{item.name}</span>
            {item.badge ? (
              <span className="relative z-10 rounded-full bg-accent px-1.5 text-[10px] font-semibold tracking-wider text-accent-foreground">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <Navbar>
        {/* Desktop: transparent full-width bar with boxed groups that shrinks
            into a floating blurred island on scroll. */}
        <NavBody>
          <Brand />
          <NavTabs pathname={pathname} />
          <MarketSearch className="ml-auto w-full max-w-md flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                aria-label="How it works"
                className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-[#17191e]/95 text-muted-foreground transition-colors hover:bg-[#2b2e35] hover:text-foreground lg:flex"
              >
                <HelpCircle className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              How it works
            </TooltipContent>
          </Tooltip>
          <AccountBar />
        </NavBody>

        {/* Mobile */}
        <MobileNav>
          <MobileNavHeader>
            <Brand />
            <div className="flex items-center gap-2">
              <AccountBar />
              <MobileNavToggle isOpen={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />
            </div>
          </MobileNavHeader>
          <MobileNavMenu isOpen={menuOpen}>
            <MarketSearch className="mb-2 w-full" />
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.link}
                href={item.link}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider',
                  pathname === item.link
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                )}
              >
                {item.name}
                {item.badge ? (
                  <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold tracking-wider text-accent-foreground">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setHelpOpen(true);
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <HelpCircle className="size-4" />
              How it works
            </button>
          </MobileNavMenu>
        </MobileNav>
      </Navbar>

      <HowItWorks open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
