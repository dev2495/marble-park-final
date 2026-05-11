'use client';

import { gql, useMutation, useQuery } from '@apollo/client';
import { useMemo, useState } from 'react';
import { Shield, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const USERS = gql`
  query UsersAdmin {
    users {
      id
      name
      email
      role
      phone
      active
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
    createUser(input: $input) { id name email role phone active }
  }
`;

const UPDATE_USER = gql`
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) { id name email role phone active }
  }
`;

const roles = [
  ['admin', 'Admin'],
  ['owner', 'Owner'],
  ['sales_manager', 'Sales Manager'],
  ['sales', 'Sales'],
  ['inventory_manager', 'Inventory'],
  ['dispatch_ops', 'Dispatch'],
  ['office_staff', 'Office Staff'],
];

const emptyForm = { name: '', email: '', phone: '', role: 'sales', password: 'password123' };

export default function UsersPage() {
  const { data, refetch } = useQuery(USERS);
  const [createUser, { loading: creating }] = useMutation(CREATE_USER);
  const [updateUser] = useMutation(UPDATE_USER);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');

  const users = data?.users || [];
  const performance = data?.ownerDashboard?.userPerformance || [];
  const performanceByUser = useMemo(() => new Map(performance.map((row: any) => [row.id, row])), [performance]);

  async function submit() {
    setMessage('');
    await createUser({ variables: { input: form } });
    setForm(emptyForm);
    setMessage('User created. Default password is password123 unless changed here.');
    await refetch();
  }

  async function toggle(user: any) {
    await updateUser({ variables: { id: user.id, input: { active: !user.active } } });
    await refetch();
  }

  return (
    <div className="space-y-7 pb-10">
      <section className="relative overflow-hidden rounded-[2.25rem] bg-[#241b14] p-8 text-white shadow-2xl shadow-[#241b14]/18">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(59,130,246,0.38),transparent_32%),radial-gradient(circle_at_92%_20%,rgba(99,102,241,0.32),transparent_28%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#ead7bd]">Admin only</p>
            <h1 className="mt-3 text-5xl font-black leading-[0.95] tracking-[-0.055em] lg:text-7xl">Users, roles and sales accountability.</h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-[#f6eadb]">Create sales, inventory and dispatch users, disable access, and track user-wise pipeline performance from the owner desk.</p>
          </div>
          <div className="grid h-20 w-20 place-items-center rounded-[1.5rem] bg-white/10"><Shield className="h-10 w-10 text-[#ead7bd]" /></div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="mp-card rounded-[2rem] p-6">
          <div className="flex items-center gap-3"><UserPlus className="h-6 w-6 text-[#b17643]" /><h2 className="text-2xl font-black">Create user</h2></div>
          <div className="mt-5 space-y-4">
            <Input placeholder="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Input placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <Input placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="h-12 w-full rounded-2xl border border-[#d9cbbd]/15 bg-white/80 px-4 text-sm font-black outline-none">
              {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Input placeholder="Password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <Button disabled={creating || !form.email || !form.name} onClick={submit} className="h-12 w-full rounded-2xl">Create user</Button>
            {message && <p className="rounded-2xl bg-[#ecfdf5] p-3 text-sm font-bold text-[#047857]">{message}</p>}
          </div>
        </div>

        <div className="mp-card rounded-[2rem] p-6">
          <div className="flex items-center justify-between"><div><h2 className="text-2xl font-black">Team access</h2><p className="mt-1 text-sm font-semibold text-[#6f6258]">Active users can log in; inactive users are blocked.</p></div><Users className="h-7 w-7 text-[#047857]" /></div>
          <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-[#d9cbbd]/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f6eadb]/70 text-[10px] uppercase tracking-widest text-[#6f6258]"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Pipeline</th><th className="p-3">Won</th><th className="p-3 text-right">Access</th></tr></thead>
              <tbody className="divide-y divide-[#d9cbbd]/10 bg-white/50">
                {users.map((user: any) => {
                  const perf: any = performanceByUser.get(user.id) || {};
                  return (
                    <tr key={user.id}>
                      <td className="p-3"><div className="font-black text-[#241b14]">{user.name}</div><div className="text-xs font-bold text-[#6f6258]">{user.email} · {user.phone}</div></td>
                      <td className="p-3"><span className="rounded-full bg-[#f6eadb] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#6f6258]">{user.role}</span></td>
                      <td className="p-3 font-black">₹{Math.round(perf.quoteValue || 0).toLocaleString('en-IN')}</td>
                      <td className="p-3 font-black text-[#047857]">{perf.confirmedQuotes || 0}</td>
                      <td className="p-3 text-right"><Button variant={user.active ? 'outline' : 'default'} onClick={() => toggle(user)} className="rounded-2xl">{user.active ? 'Active' : 'Disabled'}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
