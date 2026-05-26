'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Theme toggle — three states (light / dark / system) persisted to
 * localStorage and applied to <html class="dark"> immediately. A matching
 * inline script in RootLayout reads the saved preference before first paint
 * so there's no white-to-dark flicker on page load.
 */

type Mode = 'light' | 'dark' | 'system';

function applyMode(mode: Mode, animate = true) {
  const root = document.documentElement;
  const effective = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  const applyClass = () => {
    if (effective === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  };

  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyClass();
    return;
  }

  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };

  // Native View Transitions give a clean snapshot-to-snapshot reveal instead
  // of making every card repaint independently during a theme swap.
  if (doc.startViewTransition) {
    root.classList.add('theme-view-transition');
    const transition = doc.startViewTransition(applyClass);
    transition.ready.catch(() => undefined);
    transition.finished.finally(() => root.classList.remove('theme-view-transition'));
    return;
  }

  // Fallback for browsers without View Transitions: a soft radial wash hides
  // the instant class flip so the interaction still feels intentional.
  root.classList.add('theme-switching');
  window.requestAnimationFrame(() => {
    applyClass();
    window.setTimeout(() => root.classList.remove('theme-switching'), 680);
  });
}

function setTransitionOrigin(element?: HTMLElement | null) {
  const root = document.documentElement;
  if (element) {
    const rect = element.getBoundingClientRect();
    root.style.setProperty('--theme-x', `${rect.left + rect.width / 2}px`);
    root.style.setProperty('--theme-y', `${rect.top + rect.height / 2}px`);
  } else {
    root.style.setProperty('--theme-x', 'calc(100vw - 3rem)');
    root.style.setProperty('--theme-y', '2rem');
  }
}

export function useThemeMode(): [Mode, (m: Mode, origin?: HTMLElement | null) => void] {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    const saved = (localStorage.getItem('mp_theme') as Mode | null) || 'system';
    setMode(saved);
    applyMode(saved, false);

    // React to OS-level changes when in 'system' mode.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const cur = (localStorage.getItem('mp_theme') as Mode | null) || 'system';
      if (cur === 'system') {
        setTransitionOrigin();
        applyMode('system');
      }
    };
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  const setAndApply = (next: Mode, origin?: HTMLElement | null) => {
    localStorage.setItem('mp_theme', next);
    setMode(next);
    setTransitionOrigin(origin);
    applyMode(next);
  };

  return [mode, setAndApply];
}

const OPTIONS: Array<{ value: Mode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Tri-state toggle pill — used inside dropdown menus / settings.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [mode, setMode] = useThemeMode();
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-0.5',
        className,
      )}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          title={label}
          onClick={(event) => setMode(value, event.currentTarget)}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded text-[var(--ink-3)] transition-colors',
            mode === value
              ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm-soft'
              : 'hover:bg-[var(--surface)] hover:text-[var(--ink-2)]',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      ))}
    </div>
  );
}

/**
 * Compact single-button toggle that flips between light and dark
 * directly (no 'system' state). Suitable for places where you want a
 * single icon CTA instead of the three-segment pill.
 */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const [mode, setMode] = useThemeMode();
  const isDark = mode === 'dark' || (mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={(event) => {
        setMode(isDark ? 'light' : 'dark', event.currentTarget);
      }}
      className={cn(
        'group relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] shadow-sm-soft transition-[transform,border-color,box-shadow,background-color] duration-300 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-md-soft',
        className,
      )}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.85),transparent_30%),linear-gradient(135deg,rgba(96,165,250,0.25),rgba(124,58,237,0.20))] transition-opacity duration-300',
          isDark ? 'opacity-100' : 'opacity-60',
        )}
      />
      <Sun
        className={cn(
          'absolute h-4 w-4 text-amber-500 transition-all duration-300 ease-out',
          isDark ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-50 opacity-0',
        )}
        strokeWidth={1.9}
      />
      <Moon
        className={cn(
          'absolute h-4 w-4 text-indigo-600 transition-all duration-300 ease-out dark:text-indigo-200',
          isDark ? '-rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100',
        )}
        strokeWidth={1.9}
      />
      <span className="absolute inset-0 rounded-md ring-1 ring-white/40 transition-opacity duration-300 group-hover:opacity-100" />
    </button>
  );
}
