'use client';

import { useMemo } from 'react';

/**
 * User avatar — used wherever a person appears in the UI (sidebar footer,
 * top performers table, recent activity, profile page).
 *
 * Rules:
 *   • If `user.avatarUrl` is set, render it as an <img>.
 *   • Otherwise render initials on a colour swatch derived deterministically
 *     from `user.id` (or email/name as fallback). Same person always gets the
 *     same colour, no API/network needed, no third-party dependency.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface UserAvatarProps {
  user?: { id?: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null;
  size?: AvatarSize;
  className?: string;
  /** Force a ring around the avatar (used in the sidebar / profile hero). */
  ringed?: boolean;
}

// Palette stays within the v3 token family — 8 calm hues sampled across the
// accent set. None overpower the white surface they sit on.
const PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#dbeafe', fg: '#1d4ed8' }, // brand-100 / 700
  { bg: '#d1fae5', fg: '#047857' }, // emerald-100 / 700
  { bg: '#fde68a', fg: '#b45309' }, // amber-100 / 700
  { bg: '#fecaca', fg: '#b91c1c' }, // rose-100 / 700
  { bg: '#e9d5ff', fg: '#6d28d9' }, // violet-200 / 700
  { bg: '#bae6fd', fg: '#0369a1' }, // sky-200 / 700
  { bg: '#fbcfe8', fg: '#a21caf' }, // pink-200 / 700
  { bg: '#c7d2fe', fg: '#4338ca' }, // indigo-200 / 700
];

function seedColour(key: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx];
}

function initialsFor(user: { name?: string | null; email?: string | null } | null | undefined): string {
  const n = (user?.name || user?.email || '').trim();
  if (!n) return 'MP';
  const parts = n.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || n.slice(0, 2).toUpperCase();
}

const SIZE_MAP: Record<AvatarSize, { box: string; text: string; ring: string }> = {
  xs: { box: 'h-6 w-6', text: 'text-[10px]', ring: 'ring-2' },
  sm: { box: 'h-8 w-8', text: 'text-xs', ring: 'ring-2' },
  md: { box: 'h-9 w-9', text: 'text-sm', ring: 'ring-2' },
  lg: { box: 'h-12 w-12', text: 'text-base', ring: 'ring-2' },
  xl: { box: 'h-20 w-20', text: 'text-2xl', ring: 'ring-4' },
};

export function UserAvatar({ user, size = 'md', className = '', ringed = false }: UserAvatarProps) {
  const key = user?.id || user?.email || user?.name || 'unknown';
  const colours = useMemo(() => seedColour(String(key)), [key]);
  const initials = useMemo(() => initialsFor(user), [user]);
  const dim = SIZE_MAP[size];
  const ring = ringed ? `${dim.ring} ring-white shadow-[0_2px_8px_rgba(24,24,27,0.10)]` : '';

  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name || user.email || 'User avatar'}
        className={`${dim.box} shrink-0 rounded-full object-cover ${ring} ${className}`}
        loading="lazy"
      />
    );
  }

  return (
    <span
      aria-label={user?.name || user?.email || 'User'}
      className={`${dim.box} ${dim.text} ${ring} ${className} grid shrink-0 select-none place-items-center rounded-full font-semibold leading-none`}
      style={{ backgroundColor: colours.bg, color: colours.fg }}
    >
      {initials}
    </span>
  );
}
