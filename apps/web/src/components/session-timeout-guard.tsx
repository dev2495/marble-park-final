'use client';

import { gql, useMutation, useQuery } from '@apollo/client';
import { Clock3, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isSessionAuthenticationError } from '@/lib/session-errors';
import { useFocusTrap } from '@/hooks/use-focus-trap';

// Screen readers hear the time left only at these marks, not every second.
const ANNOUNCE_AT_SECONDS = [120, 60, 30, 10];

function spokenTimeLeft(seconds: number) {
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} left before you are signed out.`;
  }
  return `${seconds} seconds left before you are signed out.`;
}

const SESSION_STATUS = gql`
  query SessionStatus {
    sessionStatus { expiresAt serverTime idleTimeoutSeconds warningSeconds }
  }
`;

const KEEP_SESSION_ALIVE = gql`
  mutation KeepSessionAlive {
    keepSessionAlive { expiresAt serverTime idleTimeoutSeconds warningSeconds }
  }
`;

const END_SESSION = gql`
  mutation EndSession($reason: String) {
    logout(reason: $reason)
  }
`;

const EVENT_KEY = 'mp_session_event';
const CHANNEL_NAME = 'marble-park-session';
const KEEPALIVE_MAX_GAP_MS = 60_000;
const KEEPALIVE_TRAILING_MS = 1_500;

type SessionStatus = {
  expiresAt: string;
  serverTime: string;
  idleTimeoutSeconds: number;
  warningSeconds: number;
};

type SessionEvent = {
  type: 'activity' | 'status' | 'logout';
  at: number;
  expiresAt?: number;
};

function clearBrowserSessionState() {
  localStorage.removeItem('user');
  localStorage.removeItem('role_override');
}

function safeCurrentDashboardPath() {
  const path = `${window.location.pathname}${window.location.search}`;
  return path.startsWith('/dashboard') ? path : '/dashboard';
}

function publish(event: SessionEvent, channel: BroadcastChannel | null) {
  localStorage.setItem(EVENT_KEY, JSON.stringify(event));
  channel?.postMessage(event);
}

/**
 * Enforces the server-issued idle deadline without treating application
 * polling, timers, animation or tab visibility changes as user activity.
 * Only captured pointer, keyboard, touch, input and scroll events can refresh
 * the authenticated session.
 */
export function SessionTimeoutGuard() {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [warningMs, setWarningMs] = useState(120_000);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const endingRef = useRef(false);
  const lastKeepAliveRef = useRef(0);
  const keepAliveInFlightRef = useRef(false);
  const trailingRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const { data } = useQuery(SESSION_STATUS, { fetchPolicy: 'network-only', errorPolicy: 'all' });
  const [keepAlive] = useMutation(KEEP_SESSION_ALIVE);
  const [endSession] = useMutation(END_SESSION);

  const applyStatus = useCallback((status?: SessionStatus | null, broadcast = false) => {
    if (!status) return;
    const deadline = new Date(status.expiresAt).getTime();
    if (!Number.isFinite(deadline)) return;
    setExpiresAt(deadline);
    setWarningMs(Math.max(1_000, Number(status.warningSeconds || 120) * 1_000));
    if (broadcast) publish({ type: 'status', at: Date.now(), expiresAt: deadline }, channelRef.current);
  }, []);

  useEffect(() => {
    applyStatus(data?.sessionStatus);
  }, [applyStatus, data]);

  const finishSession = useCallback(async (reason: 'idle' | 'user', callServer = true) => {
    if (endingRef.current) return;
    endingRef.current = true;
    if (callServer) await endSession({ variables: { reason } }).catch(() => null);
    publish({ type: 'logout', at: Date.now() }, channelRef.current);
    clearBrowserSessionState();
    const redirect = encodeURIComponent(safeCurrentDashboardPath());
    window.location.replace(reason === 'idle' ? `/login?reason=inactive&redirect=${redirect}` : '/login');
  }, [endSession]);

  const refreshFromMeaningfulActivity = useCallback(async () => {
    if (endingRef.current || keepAliveInFlightRef.current) return;
    keepAliveInFlightRef.current = true;
    try {
      const result = await keepAlive();
      lastKeepAliveRef.current = Date.now();
      applyStatus(result.data?.keepSessionAlive, true);
    } catch (error) {
      // A short network interruption or a busy PDF renderer is not proof that
      // the server session expired. Keep the existing server-issued deadline
      // and retry on the next meaningful interaction. Explicit authentication
      // rejection still ends the browser session immediately.
      if (isSessionAuthenticationError(error)) await finishSession('idle', false);
    } finally {
      keepAliveInFlightRef.current = false;
    }
  }, [applyStatus, finishSession, keepAlive]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    }
    const acceptEvent = (event: SessionEvent) => {
      if (!event || endingRef.current) return;
      if (event.type === 'status' && event.expiresAt) setExpiresAt(event.expiresAt);
      if (event.type === 'logout') void finishSession('user', false);
    };
    const onChannel = (event: MessageEvent<SessionEvent>) => acceptEvent(event.data);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== EVENT_KEY || !event.newValue) return;
      try { acceptEvent(JSON.parse(event.newValue)); } catch { /* Ignore malformed local browser state. */ }
    };
    channelRef.current?.addEventListener('message', onChannel);
    window.addEventListener('storage', onStorage);
    return () => {
      channelRef.current?.removeEventListener('message', onChannel);
      channelRef.current?.close();
      channelRef.current = null;
      window.removeEventListener('storage', onStorage);
    };
  }, [finishSession]);

  useEffect(() => {
    const meaningfulActivity = (event: Event) => {
      if (endingRef.current || !event.isTrusted) return;
      const now = Date.now();
      publish({ type: 'activity', at: now }, channelRef.current);
      if (trailingRef.current) window.clearTimeout(trailingRef.current);
      if (now - lastKeepAliveRef.current >= KEEPALIVE_MAX_GAP_MS) {
        void refreshFromMeaningfulActivity();
        return;
      }
      trailingRef.current = window.setTimeout(() => void refreshFromMeaningfulActivity(), KEEPALIVE_TRAILING_MS);
    };
    const eventNames: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'input', 'change', 'scroll'];
    eventNames.forEach((name) => window.addEventListener(name, meaningfulActivity, { capture: true, passive: true }));
    return () => {
      eventNames.forEach((name) => window.removeEventListener(name, meaningfulActivity, { capture: true }));
      if (trailingRef.current) window.clearTimeout(trailingRef.current);
    };
  }, [refreshFromMeaningfulActivity]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const remaining = expiresAt - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) void finishSession('idle');
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt, finishSession]);

  const warningVisible = remainingMs !== null && remainingMs > 0 && remainingMs <= warningMs;
  const warningRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const lastMarkRef = useRef<number | null>(null);
  // Escape means "stay signed in"; focus starts on that button.
  useFocusTrap(warningRef, warningVisible, {
    initialFocus: stayRef,
    onEscape: () => void refreshFromMeaningfulActivity(),
  });
  const secondsLeft = remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 1_000));
  useEffect(() => {
    if (!warningVisible || secondsLeft === null) {
      lastMarkRef.current = null;
      setAnnouncement('');
      return;
    }
    // Speak once when the warning opens, then only when a mark is crossed.
    // lastMarkRef holds the seconds left at the last announcement.
    const last = lastMarkRef.current;
    if (last === null) {
      lastMarkRef.current = secondsLeft;
      setAnnouncement(spokenTimeLeft(secondsLeft));
      return;
    }
    if (ANNOUNCE_AT_SECONDS.some((m) => secondsLeft <= m && last > m)) {
      lastMarkRef.current = secondsLeft;
      setAnnouncement(spokenTimeLeft(secondsLeft));
    }
  }, [warningVisible, secondsLeft]);

  if (!warningVisible || remainingMs === null) return null;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = String(seconds % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4" >
      <div aria-hidden="true" className="mp-overlay absolute inset-0 bg-[rgba(15,16,22,0.5)] backdrop-blur-sm" />
      <div ref={warningRef} role="alertdialog" aria-modal="true" aria-labelledby="session-warning-title" aria-describedby="session-warning-description" className="mp-dialog-panel relative w-full max-w-md rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--sh-xl)] sm:p-7">
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[color-mix(in_srgb,var(--warning-border)_35%,transparent)]">
            <Clock3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--warning-fg)]">Security timeout</p>
            <h2 id="session-warning-title" className="mt-1 text-xl font-bold text-[var(--ink)]">Your session is about to end</h2>
            <p id="session-warning-description" className="mt-2 text-sm leading-6 text-[var(--ink-3)]">
              For account safety, Marble Park signs you out after 15 minutes without activity. Unsaved form entries may be lost.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between rounded-lg bg-[var(--bg-soft)] px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink-3)]"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Time remaining</span>
          <span className="font-mono text-lg font-bold tabular-nums text-[var(--ink)]" aria-hidden="true">{minutesPart}:{secondsPart}</span>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => void finishSession('user')}>Sign out now</Button>
          <Button ref={stayRef} type="button" onClick={() => void refreshFromMeaningfulActivity()}>Stay signed in</Button>
        </div>
      </div>
    </div>
  );
}
