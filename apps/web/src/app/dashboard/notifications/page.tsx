'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { ArrowRight, Bell, CheckCheck, Clock3, Inbox, RefreshCw, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

const INBOX = gql`query WorkInbox($view: String, $search: String, $cursor: String, $unreadOnly: Boolean) {
  notificationInbox(view: $view, search: $search, cursor: $cursor, unreadOnly: $unreadOnly, take: 30)
  me { id role }
}`;
const CHANGE = gql`mutation InboxChange($ids: [ID!]!, $action: String!) { updateNotifications(ids: $ids, action: $action) }`;
const PREF = gql`mutation InboxPreference($muteUpdates: Boolean!) { updateNotificationPreferences(muteUpdates: $muteUpdates) }`;
const HEALTH = gql`query InboxDeliveryHealth { notificationDeliveryHealth }`;
const views = [['action','My work'],['team','Team queue'],['open','All open work'],['updates','Updates'],['completed','Completed'],['snoozed','Snoozed'],['archived','Archived']] as const;
type Notice = { id: string; title: string; message: string; category: string; status: string; priority: string; href: string; actionLabel: string; assignedUserId?: string; targetUserId?: string; readAt?: string; dueAt?: string; createdAt: string; resolvedAt?: string };
const date = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function DeliveryHealth({ enabled }: { enabled: boolean }) {
  const { data, error, refetch } = useQuery(HEALTH, { skip: !enabled, pollInterval: 60000, skipPollAttempt: () => document.hidden });
  if (!enabled) return null;
  const health = data?.notificationDeliveryHealth;
  return <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Delivery service · {error ? 'Unable to check' : !health ? 'Checking…' : health.healthy ? 'Healthy' : 'Needs attention'}</summary>
    <div className="mt-3 flex flex-wrap items-center gap-4 text-[var(--ink-3)]"><span>{health?.pending ?? '—'} pending</span><span>{health?.failed ?? '—'} retrying</span><span>{health?.unrouted ?? '—'} without a recipient</span><span>Last source check: {health?.lastReconciledAt ? date(health.lastReconciledAt) : 'Not yet recorded'}</span><Button variant="outline" onClick={() => void refetch()}>Check again</Button></div>
    <p className="mt-2 text-xs text-[var(--ink-4)]">Failed deliveries retry automatically. A stale source check needs administrator investigation; existing work is preserved.</p>
  </details>;
}

export default function NotificationWorkspace() {
  const [view, setView] = useState('action');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const deferred = useDebouncedValue(search, 250);
  const { data, loading, error, refetch } = useQuery(INBOX, { variables: { view, search: deferred || undefined, cursor: cursor || undefined, unreadOnly }, fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true,
    pollInterval: 60000, skipPollAttempt: () => document.hidden });
  const [change, changeState] = useMutation(CHANGE);
  const [preference, preferenceState] = useMutation(PREF);
  const box = data?.notificationInbox;
  const items: Notice[] = box?.items || [];
  const me = data?.me;
  const busy = changeState.loading || preferenceState.loading;
  useEffect(() => { setCursor(null); setPages([]); setSelected([]); }, [view, deferred, unreadOnly]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void refetch(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refetch]);
  const act = async (ids: string[], action: string) => {
    setMessage('');
    try {
      await change({ variables: { ids, action } }); setSelected([]);
      setMessage(action === 'snooze' ? 'Snoozed for one hour. The source work is unchanged.' : 'Inbox updated.');
      await refetch(); window.dispatchEvent(new Event('notification-updated'));
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update the inbox. Try again.'); }
  };
  const open = (item: Notice) => { if (!item.readAt) void act([item.id], 'read'); };
  const allSelected = items.length > 0 && items.every(i => selected.includes(i.id));
  return <div className="mx-auto max-w-6xl space-y-6 pb-12 text-[var(--ink)]">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-700)]">Marble Park · Work inbox</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Your next move, in one place.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ink-3)]">From customer selection to inward and dispatch. See what needs you, open the exact work, and keep the team in sync.</p></div>
      <Button variant="outline" className="h-11" disabled={loading} onClick={() => void refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Refresh</Button>
    </header>
    <div className="flex flex-wrap gap-x-8 gap-y-3 border-y border-[var(--line)] py-4 text-sm" aria-live="polite">
      <span><strong className="mr-2 text-2xl font-semibold tabular-nums">{box?.action ?? '—'}</strong>assigned to you</span>
      <span><strong className="mr-2 text-2xl font-semibold tabular-nums">{box?.team ?? '—'}</strong>ready to claim</span>
      <span className="text-[var(--ink-3)]"><strong className="mr-2 text-2xl font-semibold tabular-nums">{box?.unread ?? '—'}</strong>unread</span>
    </div>
    <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <nav aria-label="Inbox views" className="flex overflow-x-auto border-b border-[var(--line)] p-2">
        {views.map(([key,label]) => <Button key={key} variant={view === key ? 'dark' : 'ghost'} className="h-11 shrink-0" aria-current={view === key ? 'page' : undefined} onClick={() => { setView(key); setMessage(''); }}>{label}</Button>)}
      </nav>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-4">
        <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]"/><Input aria-label="Search notifications" placeholder="Search order, customer, SKU or task…" className="h-11 pl-9" value={search} onChange={e => setSearch(e.target.value)}/></div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)}/>Unread only</label>
      </div>
      <div className="flex min-h-14 flex-wrap items-center gap-2 bg-[var(--bg-soft)] px-4 py-2">
        <label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" aria-label="Select this page" checked={allSelected} disabled={!items.length || loading} onChange={() => setSelected(allSelected ? [] : items.map(i => i.id))}/>{selected.length ? `${selected.length} selected` : 'Select page'}</label>
        {selected.length > 0 && <><Button variant="ghost" disabled={busy} onClick={() => void act(selected, 'read')}>Mark read</Button><Button variant="ghost" disabled={busy} onClick={() => void act(selected, 'unread')}>Mark unread</Button>{['updates','completed','archived'].includes(view) && <Button variant="ghost" disabled={busy} onClick={() => void act(selected, view === 'archived' ? 'restore' : 'archive')}>{view === 'archived' ? 'Restore' : 'Archive'}</Button>}</>}
        <span className="ml-auto text-xs text-[var(--ink-4)]">Reading does not complete work.</span>
      </div>
      {error && <div role="alert" className="m-4 rounded-lg border border-[var(--danger)] p-4 text-sm">Inbox could not be loaded. {error.message}<Button variant="outline" className="ml-3" onClick={() => void refetch()}>Retry</Button></div>}
      {message && <p role="status" className="border-b border-[var(--line)] p-4 text-sm">{message}</p>}
      {loading && !box ? <div role="status" className="p-12 text-center text-[var(--ink-3)]">Loading your work…</div> : !error && items.length === 0 ? <div className="px-6 py-16 text-center"><Inbox className="mx-auto h-9 w-9 text-[var(--ink-4)]"/><h2 className="mt-4 text-lg font-semibold">{search || unreadOnly ? 'No matching items' : view === 'action' ? 'Nothing assigned to you right now' : 'This view is clear'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-3)]">{view === 'action' ? 'Check the team queue for unclaimed work. New tasks appear as source records change.' : 'Try another view or clear the search. Completed work remains available in history.'}</p>{view === 'action' && <Button className="mt-5 h-11" onClick={() => setView('team')}><Users className="mr-2 h-4 w-4"/>Open team queue</Button>}</div> : <ul className="divide-y divide-[var(--line)]" aria-busy={loading}>
        {items.map(item => { const isWork = item.category === 'action'; const closed = item.status === 'resolved'; const overdue = !closed && item.dueAt && new Date(item.dueAt).getTime() < Date.now();
          return <li key={item.id} className={`p-4 sm:p-5 ${!item.readAt ? 'bg-[var(--brand-50)]/30' : ''}`}>
            <div className="flex gap-3"><label className="flex min-h-11 min-w-6 items-start pt-1"><input type="checkbox" aria-label={`Select ${item.title}`} checked={selected.includes(item.id)} onChange={e => setSelected(s => e.target.checked ? [...s,item.id] : s.filter(id => id !== item.id))}/></label>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-4)]">{closed ? <CheckCheck className="h-4 w-4"/> : isWork ? <Clock3 className="h-4 w-4"/> : <Bell className="h-4 w-4"/>}<span>{closed ? 'Completed in source' : isWork ? item.assignedUserId ? item.assignedUserId === me?.id ? 'Claimed by you' : 'Claimed by a teammate' : item.targetUserId ? 'Assigned to you' : 'Team work' : 'Update'}</span>{!item.readAt && <span className="text-[var(--brand-700)]">Unread</span>}{(overdue || item.priority === 'high') && !closed && <span className="font-semibold text-[var(--danger)]">{overdue ? 'Overdue' : 'Priority'}</span>}</div>
                <h2 className="mt-2 text-base font-semibold">{item.title}</h2><p className="mt-1 max-w-3xl break-words text-sm leading-6 text-[var(--ink-3)]">{item.message}</p>
                <p className="mt-2 text-xs tabular-nums text-[var(--ink-4)]">{item.dueAt && !closed ? `Due ${date(item.dueAt)} · ` : ''}{closed && item.resolvedAt ? `Completed ${date(item.resolvedAt)}` : `Added ${date(item.createdAt)}`}</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button asChild className="h-11"><Link href={item.href} onClick={() => open(item)}>{item.actionLabel}<ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
                  {isWork && !closed && !item.targetUserId && (!item.assignedUserId || item.assignedUserId === me?.id) && <Button variant="outline" className="h-11" disabled={busy} onClick={() => void act([item.id], item.assignedUserId ? 'release' : 'claim')}>{item.assignedUserId ? 'Release to team' : 'Claim task'}</Button>}
                  <Button variant="ghost" className="h-11" disabled={busy} onClick={() => void act([item.id], item.readAt ? 'unread' : 'read')}>{item.readAt ? 'Mark unread' : 'Mark read'}</Button>
                  {isWork && !closed && <Button variant="ghost" className="h-11" disabled={busy} onClick={() => void act([item.id], view === 'snoozed' ? 'unsnooze' : 'snooze')}>{view === 'snoozed' ? 'Unsnooze' : 'Snooze 1 hour'}</Button>}
                </div>
              </div>
            </div>
          </li>;
        })}
      </ul>}
      <footer className="flex items-center justify-between border-t border-[var(--line)] p-4 text-xs text-[var(--ink-4)]"><Button variant="outline" disabled={!pages.length || loading} onClick={() => { setCursor(pages[pages.length-1]); setPages(p => p.slice(0,-1)); setSelected([]); }}>Previous</Button><span>Page {pages.length + 1} · {items.length} shown</span><Button variant="outline" disabled={!box?.nextCursor || loading} onClick={() => { setPages(p => [...p,cursor]); setCursor(box.nextCursor); setSelected([]); }}>Next</Button></footer>
    </section>
    <section className="flex flex-col justify-between gap-3 rounded-lg bg-[var(--bg-soft)] p-4 sm:flex-row"><div><h2 className="text-sm font-semibold">Keep the bell focused</h2><p className="mt-1 text-xs text-[var(--ink-3)]">Mute routine updates in the badge. Required work stays visible; updates remain in their own view.</p></div><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!!box?.preference?.muteUpdates} disabled={busy || !box} onChange={async e => { try { await preference({ variables: { muteUpdates: e.target.checked } }); await refetch(); window.dispatchEvent(new Event('notification-updated')); } catch { setMessage('Could not save preference. Try again.'); } }}/>Mute update badge</label></section>
    <DeliveryHealth enabled={['owner','admin'].includes(me?.role)}/>
  </div>;
}
