'use client';

// Users, roles and per-user rights.
// A role gives a person their default rights. For any single right you can
// keep the role default, allow it, or deny it for that one person.
import { gql, useMutation, useQuery } from '@apollo/client';
import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Minus, Search, ShieldCheck, Trash2, UserCheck, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import { cn } from '@/lib/utils';

const USERS = gql`
  query UsersAdmin {
    users { id name email role phone active avatarUrl bio permissionOverrides effectivePermissions passwordChangedAt createdAt }
    ownerDashboard { userPerformance stats }
    permissionCatalog
  }
`;
const CREATE_USER = gql`mutation CreateUser($input: CreateUserInput!) { createUser(input: $input) { id name email role phone active avatarUrl bio permissionOverrides effectivePermissions passwordChangedAt createdAt } }`;
const UPDATE_USER = gql`mutation UpdateUser($id: ID!, $input: UpdateUserInput!) { updateUser(id: $id, input: $input) { id name email role phone active avatarUrl bio permissionOverrides effectivePermissions passwordChangedAt createdAt } }`;
const DELETE_USER = gql`mutation DeleteUser($id: ID!) { deleteUser(id: $id) { id name email role phone active } }`;

const ROLES: Array<[string, string, string]> = [
  ['owner', 'Owner', 'Everything, including money and settings.'],
  ['admin', 'Admin', 'Everything, including users and settings.'],
  ['sales_manager', 'Sales Manager', 'Quotes, approvals, payments and sales reports.'],
  ['sales', 'Sales', 'Own leads and quotes, documents.'],
  ['office_staff', 'Office Staff', 'Builds quotes, buying, receiving and fulfilment.'],
  ['inventory_manager', 'Inventory Manager', 'Catalogue, masters, stock, labels and buying.'],
  ['dispatch_ops', 'Dispatch Ops', 'Dispatch, returns and fulfilment reports.'],
];
type Catalog = { groups: string[]; permissions: Array<{ key: string; label: string; description: string; group: string; risk?: 'high' }>; implied: Record<string, string[]>; roles: Array<{ role: string; defaults: string[] }> };
type Overrides = Record<string, boolean>;

const emptyCreate = { name: '', email: '', phone: '', role: 'sales', password: '', avatarUrl: '', bio: '', permissionOverrides: {} as Overrides };
const emptyEdit = { name: '', email: '', phone: '', role: 'sales', active: true, avatarUrl: '', bio: '', permissionOverrides: {} as Overrides };

function roleLabel(role?: string) { return ROLES.find(([value]) => value === role)?.[1] || (role || 'User').replace(/_/g, ' '); }
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never'; }
function overrideCounts(overrides?: Overrides) {
  const values = Object.values(overrides || {});
  return { allowed: values.filter((value) => value === true).length, denied: values.filter((value) => value === false).length };
}

// Mirrors the server: role defaults (with implied finer rights), then this
// person's allow / deny overrides.
function effectiveFor(catalog: Catalog | undefined, role: string, overrides: Overrides) {
  const defaults = new Set(catalog?.roles.find((row) => row.role === role)?.defaults || []);
  const result = new Set(defaults);
  for (const [key, value] of Object.entries(overrides)) if (value) result.add(key);
  for (const [key, sources] of Object.entries(catalog?.implied || {})) if (overrides[key] === undefined && sources.some((source) => result.has(source))) result.add(key);
  for (const [key, value] of Object.entries(overrides)) if (value === false) result.delete(key);
  return { defaults, result };
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn('flex flex-col gap-1.5', className)}><span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-4)]">{label}</span>{children}</label>;
}
const selectClass = 'h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]';

function RightsEditor({ catalog, role, value, onChange }: { catalog?: Catalog; role: string; value: Overrides; onChange: (next: Overrides) => void }) {
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const { defaults, result } = effectiveFor(catalog, role, value);
  const counts = overrideCounts(value);
  const term = search.trim().toLowerCase();
  const set = (key: string, state: 'default' | 'allow' | 'deny') => {
    const next = { ...value };
    if (state === 'default') delete next[key]; else next[key] = state === 'allow';
    onChange(next);
  };
  if (!catalog) return <p className="text-sm text-[var(--ink-4)]">Loading rights…</p>;
  return (
    <div className="rounded-r4 border border-[var(--line)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
        <div>
          <h4 className="text-sm font-semibold text-[var(--ink)]">Rights</h4>
          <p className="text-xs text-[var(--ink-4)]">{result.size} rights · {roleLabel(role)} default{counts.allowed ? ` · ${counts.allowed} extra allowed` : ''}{counts.denied ? ` · ${counts.denied} denied` : ''}</p>
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--ink-4)]" />
          <input aria-label="Search rights" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rights" className="h-8 w-44 rounded-md border border-[var(--line)] bg-[var(--surface)] pl-8 pr-2 text-xs" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink-3)]"><input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} />Only changes</label>
        {counts.allowed + counts.denied ? <button type="button" onClick={() => onChange({})} className="text-xs font-semibold text-[var(--brand-700)] hover:underline">Reset to role defaults</button> : null}
      </div>
      <div className="max-h-[32rem] overflow-y-auto">
        {catalog.groups.map((group) => {
          const rows = catalog.permissions.filter((permission) => permission.group === group)
            .filter((permission) => !term || `${permission.label} ${permission.description} ${permission.key}`.toLowerCase().includes(term))
            .filter((permission) => !onlyChanged || value[permission.key] !== undefined);
          if (!rows.length) return null;
          return (
            <div key={group}>
              <p className="sticky top-0 z-[1] border-b border-[var(--line)] bg-[var(--bg-soft)] px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{group}</p>
              {rows.map((permission) => {
                const state = value[permission.key] === undefined ? 'default' : value[permission.key] ? 'allow' : 'deny';
                const has = result.has(permission.key);
                const byRole = defaults.has(permission.key);
                const impliedFrom = (catalog.implied[permission.key] || []).filter((source) => result.has(source));
                return (
                  <div key={permission.key} className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-3 py-2 last:border-b-0">
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', has ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--bg-soft)] text-[var(--ink-5)]')} title={has ? 'Has this right' : 'Does not have this right'}>{has ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">{permission.label}{permission.risk === 'high' ? <span className="rounded bg-[var(--danger-bg)] px-1.5 text-[10px] font-semibold text-[var(--danger)]">sensitive</span> : null}</p>
                      <p className="text-xs text-[var(--ink-4)]">{permission.description}{state === 'default' ? (byRole ? ' · included in role' : impliedFrom.length ? ` · comes with ${impliedFrom.map((key) => catalog.permissions.find((row) => row.key === key)?.label || key).join(', ')}` : '') : ''}</p>
                    </div>
                    <div className="inline-flex shrink-0 rounded-md border border-[var(--line)] p-0.5 text-[11.5px] font-semibold" role="radiogroup" aria-label={permission.label}>
                      {(['default', 'allow', 'deny'] as const).map((option) => (
                        <button key={option} type="button" role="radio" aria-checked={state === option} onClick={() => set(permission.key, option)}
                          className={cn('rounded px-2.5 py-1', state === option ? (option === 'allow' ? 'bg-[var(--success)] text-white' : option === 'deny' ? 'bg-[var(--danger)] text-white' : 'bg-[var(--ink)] text-[var(--surface)]') : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]')}>
                          {option === 'default' ? `Role (${byRole ? 'yes' : 'no'})` : option === 'allow' ? 'Allow' : 'Deny'}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoleMatrix({ catalog, users }: { catalog?: Catalog; users: any[] }) {
  const [search, setSearch] = useState('');
  if (!catalog) return null;
  const term = search.trim().toLowerCase();
  const roleCols = ROLES.filter(([role]) => catalog.roles.some((row) => row.role === role));
  const defaultsFor = (role: string) => new Set(catalog.roles.find((row) => row.role === role)?.defaults || []);
  const columnSets = roleCols.map(([role]) => defaultsFor(role));
  return (
    <section className="mp-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Role matrix</h2>
          <p className="text-sm text-[var(--ink-4)]">What each role can do by default. Change a single person from the Team tab with Allow or Deny; the number on the right shows how many people have an override for that right.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--ink-4)]" />
          <Input aria-label="Search rights" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rights" className="w-56 pl-8" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="mp-table-skin w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 bg-[var(--surface)]">
            <tr>
              <th className="border-b border-[var(--line)] px-4 py-2 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ink-4)]">Right</th>
              {roleCols.map(([role, label, help]) => (
                <th key={role} title={help} className="border-b border-[var(--line)] px-2 py-2 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--ink-4)]">{label}<span className="block font-mono font-normal normal-case tracking-normal">{users.filter((user) => user.role === role).length} people</span></th>
              ))}
              <th className="border-b border-[var(--line)] px-3 py-2 text-right text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ink-4)]">Overrides</th>
            </tr>
          </thead>
          <tbody>
            {catalog.groups.map((group) => {
              const rows = catalog.permissions.filter((permission) => permission.group === group && (!term || `${permission.label} ${permission.description}`.toLowerCase().includes(term)));
              if (!rows.length) return null;
              return (
                <Fragment key={group}>
                  <tr><td colSpan={roleCols.length + 2} className="border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{group}</td></tr>
                  {rows.map((permission) => {
                    const overridden = users.filter((user) => user.permissionOverrides && user.permissionOverrides[permission.key] !== undefined);
                    return (
                      <tr key={permission.key} className="hover:bg-[var(--surface-2)]">
                        <td className="border-b border-[var(--line)] px-4 py-2"><p className="font-semibold text-[var(--ink)]">{permission.label}{permission.risk === 'high' ? <span className="ml-1.5 rounded bg-[var(--danger-bg)] px-1.5 text-[10px] font-semibold text-[var(--danger)]">sensitive</span> : null}</p><p className="text-xs text-[var(--ink-4)]">{permission.description}</p></td>
                        {columnSets.map((set, index) => <td key={roleCols[index][0]} className="border-b border-[var(--line)] text-center">{set.has(permission.key) ? <Check className="mx-auto h-4 w-4 text-[var(--success)]" aria-label="Included" /> : <span className="text-[var(--ink-5)]" aria-label="Not included">·</span>}</td>)}
                        <td className="border-b border-[var(--line)] px-3 text-right text-xs" title={overridden.map((user) => `${user.name}: ${user.permissionOverrides[permission.key] ? 'allowed' : 'denied'}`).join('\n')}>{overridden.length ? <span className="rounded-full bg-[var(--info-bg)] px-2 py-0.5 font-semibold text-[var(--info)]">{overridden.length}</span> : <span className="text-[var(--ink-5)]">—</span>}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function UsersPage() {
  const { data, loading, error, refetch } = useQuery(USERS, { fetchPolicy: 'cache-and-network' });
  const [createUser, { loading: creating, error: createError }] = useMutation(CREATE_USER);
  const [updateUser, { loading: updating, error: updateError }] = useMutation(UPDATE_USER);
  const [deleteUser, { loading: deleting, error: deleteError }] = useMutation(DELETE_USER);
  const [tab, setTab] = useState<'team' | 'matrix'>('team');
  const [adding, setAdding] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [selectedId, setSelectedId] = useState('');
  const [editForm, setEditForm] = useState<any>(emptyEdit);
  const [resetPassword, setResetPassword] = useState('');
  const [message, setMessage] = useState('');
  const [userSearch, setUserSearch] = useState('');
  // Global search links here with ?search=… so the page opens on that record.
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('search'); if (value) setUserSearch(value); }, []);
  const [roleFilter, setRoleFilter] = useState('all');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const catalog: Catalog | undefined = data?.permissionCatalog || undefined;
  const users = useMemo<any[]>(() => data?.users || [], [data?.users]);
  const selected = useMemo(() => users.find((user: any) => user.id === selectedId) || users[0], [users, selectedId]);
  const performanceByUser = useMemo(() => new Map((data?.ownerDashboard?.userPerformance || []).map((row: any) => [row.id, row])), [data?.ownerDashboard?.userPerformance]);
  const visibleUsers = users.filter((user) => (roleFilter === 'all' || user.role === roleFilter) && (!userSearch.trim() || `${user.name} ${user.email} ${user.phone || ''}`.toLowerCase().includes(userSearch.trim().toLowerCase())));

  useEffect(() => {
    if (!selected) return;
    setEditForm({ name: selected.name || '', email: selected.email || '', phone: selected.phone || '', role: selected.role || 'sales', active: Boolean(selected.active), avatarUrl: selected.avatarUrl || '', bio: selected.bio || '', permissionOverrides: selected.permissionOverrides || {} });
    setResetPassword('');
    setConfirmRemove(false);
  }, [selected]);

  const editDirty = selected ? JSON.stringify({ ...editForm }) !== JSON.stringify({ name: selected.name || '', email: selected.email || '', phone: selected.phone || '', role: selected.role || 'sales', active: Boolean(selected.active), avatarUrl: selected.avatarUrl || '', bio: selected.bio || '', permissionOverrides: selected.permissionOverrides || {} }) : false;

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    if (!createForm.password || createForm.password.length < 12) { setMessage('Enter or generate a password of at least 12 characters.'); return; }
    const { data: result } = await createUser({ variables: { input: { ...createForm, email: createForm.email.trim().toLowerCase() } } });
    setCreateForm(emptyCreate);
    setAdding(false);
    setSelectedId(result?.createUser?.id || '');
    setMessage('User created. Share the password with them directly, not through the system.');
    await refetch();
  }
  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setMessage('');
    await updateUser({ variables: { id: selected.id, input: { ...editForm, email: editForm.email.trim().toLowerCase() } } });
    setMessage(`${editForm.name} saved.`);
    await refetch();
  }
  async function submitResetPassword() {
    if (!selected || resetPassword.length < 12) return;
    await updateUser({ variables: { id: selected.id, input: { password: resetPassword } } });
    setResetPassword('');
    setMessage(`Password reset for ${selected.name}. Share it with them directly.`);
    await refetch();
  }
  async function toggleAccess() {
    if (!selected) return;
    await updateUser({ variables: { id: selected.id, input: { active: !selected.active } } });
    setMessage(`${selected.name} ${selected.active ? 'can no longer sign in' : 'can sign in again'}.`);
    await refetch();
  }
  async function removeUser() {
    if (!selected) return;
    await deleteUser({ variables: { id: selected.id } });
    setSelectedId('');
    setConfirmRemove(false);
    setMessage(`${selected.name} removed from the team. Their past quotes and orders stay in history.`);
    await refetch();
  }

  const activeCount = users.filter((user) => user.active).length;
  const overrideUsers = users.filter((user) => Object.keys(user.permissionOverrides || {}).length).length;
  const selectedCounts = overrideCounts(editForm.permissionOverrides);

  return (
    <div className="space-y-4 pb-10">
      <header className="mp-page-header">
        <div className="min-w-0 flex-1">
          <p className="mp-eyebrow">Admin and owner only</p>
          <h1 className="mp-page-title">Users and rights</h1>
          <p className="mp-page-sub">{activeCount} active · {users.length - activeCount} disabled · {overrideUsers} with personal overrides</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--bg-soft)] p-1">
          {([['team', 'Team'], ['matrix', 'Role matrix']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={cn('rounded-md px-3 py-1.5 text-sm font-semibold', tab === value ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-3)]')}>{label}</button>)}
        </div>
        <Button type="button" onClick={() => { setAdding(true); setTab('team'); }}><UserPlus className="mr-2 h-4 w-4" />Add user</Button>
      </header>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {updateError ? <QueryErrorBanner error={updateError} /> : null}
      {deleteError ? <QueryErrorBanner error={deleteError} /> : null}
      {message ? <div role="status" className={cn('flex items-center gap-2 rounded-r4 border px-4 py-2.5 text-sm font-semibold', message.startsWith('Enter') ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}><span className="flex-1">{message}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage('')}><X className="h-4 w-4" /></button></div> : null}

      {tab === 'matrix' ? <RoleMatrix catalog={catalog} users={users} /> : null}

      {tab === 'team' && adding ? (
        <form onSubmit={submitCreate} className="mp-panel space-y-4 p-5">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><UserPlus className="h-5 w-5" /></div><div className="flex-1"><h2 className="text-lg font-semibold text-[var(--ink)]">Add user</h2><p className="text-sm text-[var(--ink-4)]">Pick a role, then adjust single rights if this person needs something different.</p></div><button type="button" aria-label="Close" onClick={() => setAdding(false)} className="rounded-md p-1.5 text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"><X className="h-4 w-4" /></button></div>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Full name"><Input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></Field>
            <Field label="Email"><Input required type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} /></Field>
            <Field label="Phone"><Input value={createForm.phone} onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })} /></Field>
            <Field label="Role"><select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })} className={selectClass}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Temporary password" className="md:col-span-2">
              <div className="flex gap-2"><Input required minLength={12} value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} placeholder="12 characters or more" /><Button type="button" variant="outline" onClick={() => setCreateForm({ ...createForm, password: generatePassword() })}>Generate</Button></div>
            </Field>
            <p className="self-end text-xs text-[var(--ink-4)] md:col-span-2">{ROLES.find(([value]) => value === createForm.role)?.[2]}</p>
          </div>
          <RightsEditor catalog={catalog} role={createForm.role} value={createForm.permissionOverrides} onChange={(permissionOverrides) => setCreateForm({ ...createForm, permissionOverrides })} />
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" disabled={creating || !createForm.email || !createForm.name || createForm.password.length < 12}>{creating ? 'Creating…' : 'Create user'}</Button></div>
        </form>
      ) : null}

      {tab === 'team' ? (
        <section className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="mp-panel flex max-h-[calc(100vh-12rem)] flex-col overflow-hidden">
            <div className="space-y-2 border-b border-[var(--line)] p-3">
              <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--ink-4)]" /><Input aria-label="Search users" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name, email, phone" className="pl-8" /></div>
              <select aria-label="Filter by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={cn(selectClass, 'h-9 text-xs')}><option value="all">All roles</option>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              {loading && !users.length ? <p className="p-6 text-center text-sm text-[var(--ink-4)]">Loading users…</p> : null}
              {visibleUsers.map((user) => {
                const counts = overrideCounts(user.permissionOverrides);
                const active = selected?.id === user.id;
                return (
                  <button key={user.id} type="button" onClick={() => setSelectedId(user.id)} className={cn('flex w-full items-center gap-3 rounded-r3 border px-2.5 py-2 text-left', active ? 'border-[var(--brand-400)] bg-[var(--brand-50)]' : 'border-transparent hover:bg-[var(--bg-soft)]')}>
                    <UserAvatar user={user} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><b className="truncate text-sm text-[var(--ink)]">{user.name}</b>{!user.active ? <span className="rounded bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-600">disabled</span> : null}</span>
                      <span className="block truncate text-xs text-[var(--ink-4)]">{roleLabel(user.role)}{counts.allowed ? ` · +${counts.allowed}` : ''}{counts.denied ? ` · −${counts.denied}` : ''}</span>
                    </span>
                  </button>
                );
              })}
              {!visibleUsers.length && users.length ? <p className="p-4 text-sm text-[var(--ink-4)]">No user matches.</p> : null}
            </div>
          </div>

          {selected ? (
            <form onSubmit={submitEdit} className="mp-panel space-y-4 p-5">
              <div className="flex flex-wrap items-start gap-4">
                <UserAvatar user={{ ...selected, avatarUrl: editForm.avatarUrl }} size="xl" ringed />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-[var(--ink)]">{selected.name}</h2>
                  <p className="text-sm text-[var(--ink-4)]">{selected.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                    <span className="rounded-full bg-[var(--brand-50)] px-2.5 py-0.5 text-[var(--brand-800)]">{roleLabel(selected.role)}</span>
                    {selectedCounts.allowed ? <span className="rounded-full bg-[var(--success-bg)] px-2.5 py-0.5 text-[var(--success)]">{selectedCounts.allowed} extra allowed</span> : null}
                    {selectedCounts.denied ? <span className="rounded-full bg-[var(--danger-bg)] px-2.5 py-0.5 text-[var(--danger)]">{selectedCounts.denied} denied</span> : null}
                    <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-0.5 text-[var(--ink-3)]">Joined {formatDate(selected.createdAt)}</span>
                    <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-0.5 text-[var(--ink-3)]">Password set {formatDate(selected.passwordChangedAt)}</span>
                    {(performanceByUser.get(selected.id) as any)?.quoteValue ? <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-0.5 text-[var(--ink-3)]">₹{Math.round((performanceByUser.get(selected.id) as any).quoteValue).toLocaleString('en-IN')} pipeline</span> : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant={selected.active ? 'outline' : 'success'} disabled={updating} onClick={toggleAccess}>{selected.active ? 'Disable sign-in' : 'Enable sign-in'}</Button>
                  <Button type="submit" disabled={updating || !editDirty}><UserCheck className="mr-2 h-4 w-4" />{updating ? 'Saving…' : 'Save'}</Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Full name"><Input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></Field>
                <Field label="Email"><Input required type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></Field>
                <Field label="Phone"><Input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} /></Field>
                <Field label="Role"><select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })} className={selectClass}>{ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              </div>
              {editForm.role !== selected.role ? <p className="flex items-center gap-2 rounded-md bg-[var(--warning-bg)] px-3 py-2 text-xs font-semibold text-[var(--warning)]"><AlertTriangle className="h-4 w-4" />Changing the role changes the defaults below. Personal Allow and Deny choices are kept.</p> : null}

              <RightsEditor catalog={catalog} role={editForm.role} value={editForm.permissionOverrides || {}} onChange={(permissionOverrides) => setEditForm({ ...editForm, permissionOverrides })} />

              <details className="rounded-r4 border border-[var(--line)]">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-[var(--ink)]">Profile photo and note</summary>
                <div className="grid gap-4 border-t border-[var(--line)] p-3 md:grid-cols-2">
                  <Field label="Photo URL"><Input value={editForm.avatarUrl} onChange={(event) => setEditForm({ ...editForm, avatarUrl: event.target.value })} placeholder="Optional" /></Field>
                  <Field label="Internal note"><Input value={editForm.bio} onChange={(event) => setEditForm({ ...editForm, bio: event.target.value.slice(0, 280) })} /></Field>
                </div>
              </details>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-r4 border border-[var(--line)] p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><KeyRound className="h-4 w-4 text-[var(--warning)]" />Reset password</p>
                  <div className="mt-2 flex gap-2">
                    <Input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New password, 12+ characters" />
                    <Button type="button" variant="outline" onClick={() => setResetPassword(generatePassword())}>Generate</Button>
                    {resetPassword ? <Button type="button" variant="ghost" title="Copy password" onClick={() => navigator.clipboard?.writeText(resetPassword)}><Copy className="h-4 w-4" /></Button> : null}
                    <Button type="button" disabled={resetPassword.length < 12 || updating} onClick={submitResetPassword}>Apply</Button>
                  </div>
                </div>
                <div className="rounded-r4 border border-[var(--danger)]/25 p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><ShieldCheck className="h-4 w-4 text-[var(--danger)]" />Remove from team</p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">Their past quotes and orders stay in history.</p>
                  {confirmRemove ? (
                    <div className="mt-2 flex gap-2"><Button type="button" variant="destructive" disabled={deleting} onClick={removeUser}><Trash2 className="mr-2 h-4 w-4" />Yes, remove {selected.name}</Button><Button type="button" variant="outline" onClick={() => setConfirmRemove(false)}>Keep</Button></div>
                  ) : <Button type="button" variant="outline" className="mt-2 border-red-200 text-red-700" onClick={() => setConfirmRemove(true)}>Remove…</Button>}
                </div>
              </div>
            </form>
          ) : <div className="mp-panel grid place-items-center p-10 text-sm text-[var(--ink-4)]">Select a user.</div>}
        </section>
      ) : null}
    </div>
  );
}
