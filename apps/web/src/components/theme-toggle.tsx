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

function applyMode(mode: Mode, animate = false) {
  const root = document.documentElement;
  const effective = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  const writeTheme = () => {
    root.dataset.theme = effective;
    root.style.colorScheme = effective;
    root.classList.toggle('dark', effective === 'dark');
  };

  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    writeTheme();
    return;
  }

  root.classList.add('theme-transitioning');
  const viewTransition = (document as any).startViewTransition;
  if (typeof viewTransition === 'function') {
    const transition = viewTransition.call(document, writeTheme);
    transition.finished.finally(() => root.classList.remove('theme-transitioning'));
    return;
  }

  writeTheme();
  window.setTimeout(() => root.classList.remove('theme-transitioning'), 560);
}

export function useThemeMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    const saved = (localStorage.getItem('mp_theme') as Mode | null) || 'system';
    setMode(saved);
    applyMode(saved);

    // React to OS-level changes when in 'system' mode.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const cur = (localStorage.getItem('mp_theme') as Mode | null) || 'system';
      if (cur === 'system') applyMode('system');
    };
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  const setAndApply = (next: Mode) => {
    localStorage.setItem('mp_theme', next);
    setMode(next);
    applyMode(next, true);
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
          onClick={() => setMode(value)}
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
      onClick={() => setMode(isDark ? 'light' : 'dark')}
      className={cn(
        'group relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] shadow-sm-soft transition-[background-color,border-color,color,transform] hover:-translate-y-0.5 hover:bg-[var(--bg-soft)]',
        className,
      )}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <span className="absolute inset-1 rounded-[5px] bg-[radial-gradient(circle_at_30%_20%,rgba(96,165,250,0.22),transparent_54%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      {isDark
        ? <Sun className="relative h-4 w-4 rotate-0 scale-100 transition-transform duration-300 ease-out group-active:rotate-45 group-active:scale-90" strokeWidth={1.7} />
        : <Moon className="relative h-4 w-4 rotate-0 scale-100 transition-transform duration-300 ease-out group-active:-rotate-12 group-active:scale-90" strokeWidth={1.7} />}
    </button>
  );
}
