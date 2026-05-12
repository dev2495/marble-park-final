'use client';

import { gql, useMutation, useQuery } from '@apollo/client';
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Copy, KeyRound, Mail, MoreHorizontal, Shield, Trash2,
  UserCheck, UserCog, UserPlus, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import { cn } from '@/lib/utils';

const USERS = gql`
  query UsersAdmin {
    users {
      id
      name
      email
      role
      phone
      active
      avatarUrl
      bio
      passwordChangedAt
      createdAt
    }
    ownerDashboard {
      userPerformance
      stats
    }
  }
`;

const CREATE_USER = gql`
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) { id name email role phone active avatarUrl bio passwordChangedAt createdAt }
  }
`;

const UPDATE_USER = gql`
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) { id name email role phone active avatarUrl bio passwordChangedAt createdAt }
  }
`;

const DELETE_USER = gql`
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id) { id name email role phone active }
  }
`;

const roles = [
  ['admin', 'Admin'],
  ['owner', 'Owner'],
  ['sales_manager', 'Sales Manager'],
  ['sales', 'Sales'],
  ['inventory_manager', 'Inventory Manager'],
  ['dispatch_ops', 'Dispatch Ops'],
  ['office_staff', 'Office Staff'],
];

const emptyCreate = { name: '', email: '', phone: '', role: 'sales', password: '', avatarUrl: '', bio: '' };
const emptyEdit = { name: '', email: '', phone: '', role: 'sales', active: true, avatarUrl: '', bio: '' };

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function roleLabel(role?: string) {
  return roles.find(([value]) => value === role)?.[1] || (role || 'User').replace(/_/g, ' ');
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('space-y-1.5', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">{label}</span>
      {children}
    </label>
  );
}

export default function UsersPage() {
  const { data, loading, error, refetch } = useQuery(USERS, { fetchPolicy: 'cache-and-network' });
  const [createUser, { loading: creating, error: createError }] = useMutation(CREATE_USER);
  const [updateUser, { loading: updating, error: updateError }] = useMutation(UPDATE_USER);
  const [deleteUser, { loading: deleting, error: deleteError }] = useMutation(DELETE_USER);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [selectedId, setSelectedId] = useState('');
  const [editForm, setEditForm] = useState<any>(emptyEdit);
  const [resetPassword, setResetPassword] = useState('');
  const [message, setMessage] = useState('');

  const users = data?.users || [];
  const selected = useMemo(() => users.find((user: any) => user.id === selectedId) || users[0], [users, selectedId]);
  const performance = data?.ownerDashboard?.userPerformance || [];
  const performanceByUser = useMemo(() => new Map(performance.map((row: any) => [row.id, row])), [performance]);

  useEffect(() => {
    if (!selected) return;
    setEditForm({
      name: selected.name || '',
      email: selected.email || '',
      phone: selected.phone || '',
      role: selected.role || 'sales',
      active: Boolean(selected.active),
      avatarUrl: selected.avatarUrl || '',
      bio: selected.bio || '',
    });
    setResetPassword('');
    setMessage('');
  }, [selected?.id]);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    if (!createForm.password || createForm.password.length < 8) {
      setMessage('Enter or generate a password of at least 8 characters.');
      return;
    }
    const { data: result } = await createUser({ variables: { input: { ...createForm, email: createForm.email.trim().toLowerCase() } } });
    setCreateForm(emptyCreate);
    setSelectedId(result?.createUser?.id || '');
    setMessage('User created. Share the password securely outside the system.');
    await refetch();
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setMessage('');
    await updateUser({ variables: { id: selected.id, input: { ...editForm, email: editForm.email.trim().toLowerCase() } } });
    setMessage('User details saved.');
    await refetch();
  }

  async function submitResetPassword() {
    if (!selected || !resetPassword) return;
    setMessage('');
    await updateUser({ variables: { id: selected.id, input: { password: resetPassword } } });
    setResetPassword('');
    setMessage(`Password reset for ${selected.name}. Share the new password securely.`);
    await refetch();
  }

  async function toggleAccess(user = selected) {
    if (!user) return;
    setMessage('');
    await updateUser({ variables: { id: user.id, input: { active: !user.active } } });
    setMessage(`${user.name} ${user.active ? 'disabled' : 'enabled'}.`);
    await refetch();
  }

  async function removeUser() {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.name} from active team access? Their past quotes/orders stay in history.`)) return;
    setMessage('');
    await deleteUser({ variables: { id: selected.id } });
    setSelectedId('');
    setMessage('User removed from active team access.');
    await refetch();
  }

  const activeUsers = users.filter((user: any) => user.active).length;
  const inactiveUsers = users.length - activeUsers;

  return (
    <div className="space-y-7 pb-10">
      <section className="mp-hero relative overflow-hidden p-7 lg:p-9">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(37,99,235,0.14),transparent_32%),radial-gradient(circle_at_90%_88%,rgba(16,185,129,0.14),transparent_28%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-4)]">Admin / Owner only</p>
            <h1 className="mt-3 max-w-5xl font-display text-4xl font-bold leading-[0.96] tracking-[-0.045em] text-[var(--ink)] lg:text-7xl">Users, roles and controlled access.</h1>
            <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-[var(--ink-3)]">
              Create staff accounts, assign role-specific workspaces, reset passwords, disable access, and keep sales accountability tied to the right user.
            </p>
          </div>
          <div className="grid min-w-[16rem] grid-cols-2 gap-3">
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Active</p>
              <p className="mt-2 font-display text-4xl font-bold text-[var(--ink)]">{activeUsers}</p>
            </div>
            <div className="rounded-r4 border border-[var(--line)] bg-[var(--surface)]/78 p-4 shadow-sm-soft">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-5)]">Disabled</p>
              <p className="mt-2 font-display text-4xl font-bold text-[var(--ink)]">{inactiveUsers}</p>
            </div>
          </div>
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {updateError ? <QueryErrorBanner error={updateError} /> : null}
      {deleteError ? <QueryErrorBanner error={deleteError} /> : null}
      {message ? (
        <div className={cn('rounded-r4 border p-4 text-sm font-semibold', message.includes('Enter') ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <form onSubmit={submitCreate} className="mp-panel p-5 lg:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><UserPlus className="h-5 w-5" /></div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Add user</h2>
              <p className="text-sm text-[var(--ink-4)]">No default password is prefilled.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4">
            <Field label="Full name"><Input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="Staff member name" /></Field>
            <Field label="Email"><Input required type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} placeholder="name@company.com" /></Field>
            <Field label="Phone"><Input value={createForm.phone} onChange={(event) => setCreateForm({ ...createForm, phone: event.target.value })} placeholder="Mobile number" /></Field>
            <Field label="Role">
              <select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]">
                {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Temporary password">
              <div className="flex gap-2">
                <Input required minLength={8} type="text" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} placeholder="Enter or generate password" />
                <Button type="button" variant="outline" onClick={() => setCreateForm({ ...createForm, password: generatePassword() })}>Generate</Button>
              </div>
            </Field>
            <Field label="Avatar URL"><Input value={createForm.avatarUrl} onChange={(event) => setCreateForm({ ...createForm, avatarUrl: event.target.value })} placeholder="Optional image URL" /></Field>
            <Field label="Notes / bio">
              <textarea value={createForm.bio} onChange={(event) => setCreateForm({ ...createForm, bio: event.target.value.slice(0, 280) })} rows={3} className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]" />
            </Field>
            <Button type="submit" disabled={creating || !createForm.email || !createForm.name || !createForm.password} className="h-11">{creating ? 'Creating…' : 'Create user'}</Button>
          </div>
        </form>

        <div className="mp-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">Team access</h2>
              <p className="mt-1 text-sm text-[var(--ink-4)]">Select a user to edit details, role, access and password.</p>
            </div>
            <Users className="h-7 w-7 text-[var(--success)]" />
          </div>
          <div className="grid min-h-[34rem] lg:grid-cols-[0.92fr_1.08fr]">
            <div className="border-b border-[var(--line)] p-3 lg:border-b-0 lg:border-r">
              {loading && !users.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">Loading users…</p> : null}
              <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {users.map((user: any) => {
                  const perf: any = performanceByUser.get(user.id) || {};
                  const active = selected?.id === user.id;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => setSelectedId(user.id)}
                      className={cn('w-full rounded-r4 border p-3 text-left transition-all', active ? 'border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--bg-soft)]')}
                    >
                      <div className="flex items-center gap-3">
                        <UserAvatar user={user} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--ink)]">{user.name}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', user.active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600')}>{user.active ? 'Active' : 'Disabled'}</span>
                          </div>
                          <p className="truncate text-xs font-medium text-[var(--ink-4)]">{user.email}</p>
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-5)]">{roleLabel(user.role)} · ₹{Math.round(perf.quoteValue || 0).toLocaleString('en-IN')} pipeline</p>
                        </div>
                        <MoreHorizontal className="h-4 w-4 text-[var(--ink-5)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-5">
              {selected ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-4">
                    <UserAvatar user={{ ...selected, avatarUrl: editForm.avatarUrl }} size="xl" ringed />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{selected.name}</h3>
                      <p className="mt-1 text-sm text-[var(--ink-4)]">{selected.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-[var(--brand-50)] px-3 py-1 text-[var(--brand-800)]">{roleLabel(selected.role)}</span>
                        <span className="rounded-full bg-[var(--bg-soft)] px-3 py-1 text-[var(--ink-3)]">Joined {formatDate(selected.createdAt)}</span>
                        <span className="rounded-full bg-[var(--bg-soft)] px-3 py-1 text-[var(--ink-3)]">Password {formatDate(selected.passwordChangedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={submitEdit} className="grid gap-4 md:grid-cols-2">
                    <Field label="Full name"><Input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required /></Field>
                    <Field label="Email"><Input value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} type="email" required /></Field>
                    <Field label="Phone"><Input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} /></Field>
                    <Field label="Role">
                      <select value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value })} className="h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]">
                        {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </Field>
                    <Field label="Avatar URL" className="md:col-span-2"><Input value={editForm.avatarUrl} onChange={(event) => setEditForm({ ...editForm, avatarUrl: event.target.value })} placeholder="Optional image URL" /></Field>
                    <Field label="Bio / internal note" className="md:col-span-2">
                      <textarea value={editForm.bio} onChange={(event) => setEditForm({ ...editForm, bio: event.target.value.slice(0, 280) })} rows={3} className="w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--brand-400)] focus:ring-2 focus:ring-[var(--ring)]" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                      <Button type="submit" disabled={updating}><UserCheck className="mr-2 h-4 w-4" /> {updating ? 'Saving…' : 'Save details'}</Button>
                      <Button type="button" variant={selected.active ? 'outline' : 'success'} onClick={() => toggleAccess()}>{selected.active ? 'Disable access' : 'Enable access'}</Button>
                      <Button type="button" variant="destructive" disabled={deleting} onClick={removeUser}><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
                    </div>
                  </form>

                  <div className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)] p-4">
                    <div className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-[var(--warning)]" /><h4 className="font-semibold text-[var(--ink)]">Reset password</h4></div>
                    <p className="mt-1 text-sm text-[var(--ink-4)]">Admin/owner reset only. The new password must be shared securely with the user.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input value={resetPassword} minLength={8} onChange={(event) => setResetPassword(event.target.value)} placeholder="New password" />
                      <Button type="button" variant="outline" onClick={() => setResetPassword(generatePassword())}>Generate</Button>
                      <Button type="button" disabled={!resetPassword || resetPassword.length < 8 || updating} onClick={submitResetPassword}>Apply</Button>
                      {resetPassword ? <Button type="button" variant="ghost" title="Copy password" onClick={() => navigator.clipboard?.writeText(resetPassword)}><Copy className="h-4 w-4" /></Button> : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <UserCog className="mx-auto h-10 w-10 text-[var(--ink-5)]" />
                    <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">Select a user</h3>
                    <p className="mt-1 text-sm text-[var(--ink-4)]">Create or select a user to manage access.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
