'use client';

/*
 * Resizable navbar (adapted from Aceternity UI) — Hunchbook dark-glass skin.
 * On scroll the bar shrinks into a floating pill with blur + shadow, like the
 * DeepBook site nav. Sizes are tuned to our shell: 62px bar, rounded-2xl,
 * theme tokens instead of zinc/white.
 */

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'motion/react';
import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface NavbarProps {
  children: React.ReactNode;
  className?: string;
}

interface NavBodyProps {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}

interface NavItemsProps {
  items: {
    name: string;
    link: string;
    badge?: string;
  }[];
  pathname?: string;
  className?: string;
  onItemClick?: () => void;
}

interface MobileNavProps {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}

interface MobileNavHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface MobileNavMenuProps {
  children: React.ReactNode;
  className?: string;
  isOpen: boolean;
}

export const Navbar = ({ children, className }: NavbarProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const [visible, setVisible] = useState<boolean>(false);

  // Hysteresis: expand below 60px, shrink past 120px — never flickers when
  // the scroll position hovers around a single threshold.
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setVisible((v) => (v ? latest > 60 : latest > 120));
  });

  return (
    <motion.div
      ref={ref}
      className={cn('sticky inset-x-0 top-0 z-50 w-full px-4 pt-3 md:px-6', className)}
    >
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ visible?: boolean }>, { visible })
          : child,
      )}
    </motion.div>
  );
};

export const NavBody = ({ children, className, visible }: NavBodyProps) => {
  return (
    <motion.div
      animate={{
        backdropFilter: visible ? 'blur(16px)' : 'blur(10px)',
        boxShadow: visible
          ? '0 0 24px rgba(2, 8, 20, 0.45), 0 1px 1px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(148, 184, 255, 0.12), 0 16px 68px rgba(2, 8, 20, 0.35), 0 1px 0 rgba(255, 255, 255, 0.06) inset'
          : 'none',
        width: visible ? 'min(1200px, 100%)' : '100%',
        y: visible ? 12 : 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 50,
      }}
      className={cn(
        'relative z-[60] mx-auto hidden h-[62px] w-full max-w-[1440px] flex-row items-center gap-4 self-start rounded-2xl border px-4 lg:flex',
        visible
          ? 'border-white/10 bg-[rgba(9,14,24,0.88)]'
          : 'border-transparent bg-transparent',
        className,
      )}
    >
      {children}
    </motion.div>
  );
};

export const NavItems = ({ items, pathname, className, onItemClick }: NavItemsProps) => {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <motion.div
      onMouseLeave={() => setHovered(null)}
      className={cn(
        'hidden flex-row items-center text-sm font-medium lg:flex',
        className,
      )}
    >
      {items.map((item, idx) => (
        <Link
          onMouseEnter={() => setHovered(idx)}
          onClick={onItemClick}
          className={cn(
            'relative flex items-center gap-1.5 px-3 py-2 transition-colors',
            pathname === item.link
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={`link-${idx}`}
          href={item.link}
        >
          {hovered === idx && (
            <motion.div
              layoutId="hovered"
              className="absolute inset-0 h-full w-full rounded-full bg-white/[0.06]"
            />
          )}
          <span className="relative z-20">{item.name}</span>
          {item.badge ? (
            <span className="relative z-20 rounded-full bg-accent px-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
              {item.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </motion.div>
  );
};

export const MobileNav = ({ children, className, visible }: MobileNavProps) => {
  return (
    <motion.div
      animate={{
        backdropFilter: visible ? 'blur(16px)' : 'blur(10px)',
        boxShadow: visible
          ? '0 0 24px rgba(2, 8, 20, 0.45), 0 0 0 1px rgba(148, 184, 255, 0.12)'
          : 'none',
        width: visible ? '94%' : '100%',
        y: visible ? 12 : 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 200,
        damping: 50,
      }}
      className={cn(
        'relative z-50 mx-auto flex h-[62px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[rgba(9,14,24,0.78)] px-3 lg:hidden',
        visible && 'bg-[rgba(9,14,24,0.88)]',
        className,
      )}
    >
      {children}
    </motion.div>
  );
};

export const MobileNavHeader = ({ children, className }: MobileNavHeaderProps) => {
  return (
    <div className={cn('flex w-full flex-row items-center justify-between', className)}>
      {children}
    </div>
  );
};

export const MobileNavMenu = ({ children, className, isOpen }: MobileNavMenuProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            'absolute inset-x-0 top-[70px] z-50 flex w-full flex-col items-start justify-start gap-1 rounded-2xl border border-white/10 bg-popover px-4 py-6 shadow-2xl backdrop-blur-xl',
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const MobileNavToggle = ({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) => {
  const Icon = isOpen ? X : Menu;
  return (
    <button type="button" aria-label={isOpen ? 'Close menu' : 'Open menu'} onClick={onClick}>
      <Icon className="size-5 text-foreground" />
    </button>
  );
};

/** DeepBook-style solid blue CTA (their site's "Docs" button). */
export const NavbarButton = ({
  href,
  as: Tag = 'a',
  children,
  className,
  variant = 'gradient',
  ...props
}: {
  href?: string;
  as?: React.ElementType;
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'gradient';
} & (React.ComponentPropsWithoutRef<'a'> | React.ComponentPropsWithoutRef<'button'>)) => {
  const baseStyles =
    'inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-center text-sm font-semibold transition duration-200 hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60';

  const variantStyles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-white/[0.06] text-foreground hover:bg-white/10',
    gradient:
      'bg-gradient-to-b from-[#3b82f6] to-[#1d59e0] text-white shadow-[0px_1px_0px_0px_rgba(255,255,255,0.3)_inset] hover:brightness-110',
  };

  return (
    <Tag href={href || undefined} className={cn(baseStyles, variantStyles[variant], className)} {...props}>
      {children}
    </Tag>
  );
};
