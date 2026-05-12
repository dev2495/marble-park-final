'use client';

import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect } from 'react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { UserAvatar } from '@/components/user-avatar';

/**
 * Shared dashboard primitives.
 *
 * Goals:
 *   • Six per-role dashboards should look like one product, not six.
 *   • Animation is *baked in* — every KPI tile animates its number into
 *     place, every grid staggers its entry. Pages stay declarative.
 *   • Tones (brand/success/warning/danger/violet/sky/neutral) are the only
 *     opinions a caller needs to make. Everything else is fixed.
 */

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'violet' | 'sky' | 'neutral';

const TONE_TEXT: Record<Tone, string> = {
  brand:   'text-[#1d4ed8]',
  success: 'text-[#047857]',
  warning: 'text-[#b45309]',
  danger:  'text-[#b91c1c]',
  violet:  'text-[#6d28d9]',
  sky:     'text-[#0369a1]',
  neutral: 'text-[#52525b]',
};

// ── Number countup ──────────────────────────────────────────────────────
// Animates a numeric value from 0 (or `from`) to its target over `duration`.
// Format function lets the caller render money/percent/qty in their own
// style. The animation only fires when the *target* changes — so a refetch
// that produces the same number stays still.
export function Countup({
  value,
  from = 0,
  duration = 0.9,
  format = (v) => Math.round(v).toLocaleString('en-IN'),
  className = '',
}: {
  value: number;
  from?: number;
  duration?: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const mv = useMotionValue(from);
  const rounded = useTransform(mv, (latest) => format(latest));
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <motion.span className={className}>{rounded as any}</motion.span>;
}

// ── Animated grid (staggered entry) ─────────────────────────────────────
export function MotionGrid({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      transition={{ delayChildren: delay, staggerChildren: 0.05 }}
      variants={{ hidden: {}, show: {} }}
    >
      {children}
    </motion.div>
  );
}

export function MotionItem({
  children,
  className = '',
  index = 0,
}: {
  children: React.ReactNode;
  className?: string;
  index?: number;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
      }}
      className={className}
      custom={index}
    >
      {children}
    </motion.div>
  );
}

// ── KPI tile ────────────────────────────────────────────────────────────
export function KpiTile({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'neutral',
  href,
  loading,
  format,
  numeric,
  trend,
}: {
  label: string;
  value: string | number;
  caption?: string;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
  loading?: boolean;
  /** If provided + value is numeric, animates the number into place. */
  format?: (v: number) => string;
  numeric?: boolean;
  /** Optional trend % vs prior period — rendered as a tiny pill. */
  trend?: { delta: number; label: string };
}) {
  const Wrap: any = href ? Link : 'div';
  const wrapProps: any = href ? { href } : {};
  const showCountup = numeric && typeof value === 'number' && !loading;
  return (
    <Wrap
      {...wrapProps}
      className={`mp-kpi-tint-${tone} group block rounded-r5 border border-[#e4e4e7] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#d4d4d8] hover:shadow-md-soft`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">{label}</p>
        <span className={`mp-kpi-icon-${tone} grid h-7 w-7 place-items-center rounded-md`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </div>
      <div className="mt-4">
        <p className="font-display text-3xl font-bold leading-none tabular-nums tracking-[-0.02em] text-[#18181b]">
          {loading ? '—' : showCountup ? <Countup value={value as number} format={format} /> : value}
        </p>
        {trend ? (
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${trend.delta >= 0 ? 'bg-[#d1fae5] text-[#047857]' : 'bg-[#fecaca] text-[#b91c1c]'}`}>
              {trend.delta >= 0 ? '▲' : '▼'} {Math.abs(trend.delta).toFixed(1)}%
            </span>
            <span className="text-[10px] text-[#71717a]">{trend.label}</span>
          </div>
        ) : null}
        {caption ? <p className="mt-2 truncate text-xs text-[#52525b]">{caption}</p> : null}
      </div>
      {href ? (
        <div className={`mt-4 flex items-center gap-1 text-xs font-medium ${TONE_TEXT[tone]} opacity-0 transition-opacity group-hover:opacity-100`}>
          Open <ArrowUpRight className="h-3 w-3" />
        </div>
      ) : null}
    </Wrap>
  );
}

// ── Panel (titled card) ─────────────────────────────────────────────────
export function Panel({
  title,
  subtitle,
  children,
  rightAction,
  tone,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightAction?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const band = tone ? `mp-panel-band-${tone}` : '';
  return (
    <section className={`mp-panel ${className}`}>
      <header className={`flex items-start justify-between gap-3 px-5 pb-3 pt-5 ${band}`}>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#18181b]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-[#71717a]">{subtitle}</p> : null}
        </div>
        {rightAction}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────
export function EmptyState({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-r4 border border-dashed border-[#e4e4e7] bg-[#fafafa] p-6 text-center text-sm text-[#71717a] ${className}`}>
      {children}
    </div>
  );
}

// ── Quick-action chip ───────────────────────────────────────────────────
export function QuickAction({ href, icon: Icon, label, tone = 'neutral' }: { href: string; icon: LucideIcon; label: string; tone?: Tone }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-md border border-[#e4e4e7] bg-white px-3 py-1.5 text-xs font-medium text-[#27272a] transition-colors hover:bg-[#f4f4f5] hover:text-[#18181b]`}
    >
      <span className={`mp-kpi-icon-${tone} grid h-5 w-5 place-items-center rounded`}>
        <Icon className="h-3 w-3" strokeWidth={2} />
      </span>
      {label}
    </Link>
  );
}

// ── Dashboard greeting strip ────────────────────────────────────────────
// Shown at the top of every role dashboard. Now carries the user's avatar
// directly so the page personalises immediately — name + role + workspace
// context, all in one block.
export function GreetingStrip({
  role,
  name,
  user,
  subtitle,
  actions,
}: {
  role: string;
  name?: string;
  /** Pass the full user so the avatar uses uploaded photo when present. */
  user?: { id?: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const hour = new Date().getHours();
  const head = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const display = name || user?.name || '';
  const first = display ? String(display).split(/\s+/)[0] : '';
  const greeting = first ? `${head}, ${first}.` : `${head}.`;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <UserAvatar user={user || { name: display }} size="lg" ringed />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">
            {role.replace('_', ' ')} workspace
          </p>
          <h1 className="mt-0.5 font-display text-2xl font-bold leading-tight tracking-[-0.02em] text-[#18181b] sm:text-3xl">
            {greeting}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-[#52525b]">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────
export function moneyShort(value: number): string {
  const n = Math.round(Number(value || 0));
  if (Math.abs(n) >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}
export function moneyExact(value: number): string {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}
export function quoteTotal(lines: any): number {
  return (Array.isArray(lines) ? lines : []).reduce(
    (sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0),
    0,
  );
}
