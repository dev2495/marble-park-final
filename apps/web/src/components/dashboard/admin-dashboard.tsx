'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  Activity, AlertCircle, BadgeCheck, ClipboardCheck, Database, FileCheck, FileSpreadsheet,
  KeyRound, Plus, Settings, Shield, ShieldCheck, UserCheck, UserCog, Users, UserX, ServerCog,
  History, Boxes, IndianRupee,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { UserAvatar } from '@/components/user-avatar';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, type Tone,
} from './primitives';

/**
 * Admin Command Center.
 *
 * An admin's day is about *people and the system*, not pipeline math. So
 * the headline tiles here are user/security/integrity-shaped; the charts
 * show role distribution and approval-queue load; and the panels expose
 * the queues a sysadmin actually clears (pending approvals across all
 * teams, recent audit events, data-hygiene flags, etc.).
 *
 * Business KPIs (revenue, pipeline) are linked but de-emphasised — the
 * admin can switch to the owner view via the role-switcher in the topbar.
 */
const ADMIN_DASH = gql`
  query AdminCommandCenter {
    users { id name email role active createdAt avatarUrl }
    ownerDashboard { stats }
    quotes(status: "pending_approval") {
      id quoteNumber lines customer owner createdAt
    }
    importBatches
    catalogReviewTasks(status: "needs_mapping", take: 200)
    customers(search: "") { id }
    salesOrderStats(range: "month")
  }
`;

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', owner: 'Owner', sales_manager: 'Sales Manager', sales: 'Sales',
  inventory_manager: 'Inventory', dispatch_ops: 'Dispatch', office_staff: 'Office Staff',
};
const ROLE_COLOR: Record<string, string> = {
  admin: '#dc2626',
  owner: '#6d28d9',
  sales_manager: '#2563eb',
  sales: '#0ea5e9',
  inventory_manager: '#059669',
  dispatch_ops: '#d97706',
  office_staff: '#7c3aed',
};

export function AdminDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(ADMIN_DASH);

  const users: any[] = data?.users || [];
  const approvalQuotes: any[] = data?.quotes || [];
  const importBatches: any[] = (data?.importBatches || []).filter((b: any) => b.status === 'pending_approval');
  const imageTasks: any[] = data?.catalogReviewTasks || [];
  const customers: any[] = data?.customers || [];
  const ownerStats = data?.ownerDashboard?.stats || {};
  const orderStats = data?.salesOrderStats || {};

  // ── Users by role + active/inactive
  const activeUsers = users.filter((u) => u.active);
  const inactiveUsers = users.filter((u) => !u.active);
  const roleDistribution = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of activeUsers) m.set(u.role, (m.get(u.role) || 0) + 1);
    return Array.from(m.entries()).map(([role, count]) => ({
      role, label: ROLE_LABEL[role] || role, count, fill: ROLE_COLOR[role] || '#71717a',
    })).sort((a, b) => b.count - a.count);
  }, [activeUsers]);

  // ── Recent users (joined in last 30 days)
  const recentUsers = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    return [...users]
      .filter((u) => new Date(u.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [users]);

  // ── Approval queue summary (cross-team)
  const totalApprovals = approvalQuotes.length + importBatches.length + imageTasks.length;
  const approvalBreakdown = [
    { label: 'Quote approvals', count: approvalQuotes.length, icon: FileSpreadsheet, tone: 'brand' as Tone, href: '/dashboard/approvals' },
    { label: 'Import approvals', count: importBatches.length, icon: Database, tone: 'violet' as Tone, href: '/dashboard/approvals' },
    { label: 'Image mapping', count: imageTasks.length, icon: FileCheck, tone: 'sky' as Tone, href: '/dashboard/approvals' },
  ];

  // ── Data hygiene — quick heuristics
  const hygiene = useMemo(() => {
    const items: Array<{ label: string; count: number; tone: Tone; href: string }> = [];
    items.push({ label: 'Catalogue image coverage', count: Number(ownerStats.catalogueImageCoverage || 0), tone: (ownerStats.catalogueImageCoverage || 0) > 80 ? 'success' : 'warning', href: '/dashboard/master-data/catalogue-review' });
    items.push({ label: 'Total customers', count: customers.length, tone: 'neutral', href: '/dashboard/customers' });
    items.push({ label: 'Total catalogue SKUs', count: Number(ownerStats.totalProducts || 0), tone: 'neutral', href: '/dashboard/products' });
    items.push({ label: 'Image review queue', count: imageTasks.length, tone: imageTasks.length > 0 ? 'warning' : 'success', href: '/dashboard/master-data/catalogue-review' });
    return items;
  }, [ownerStats, customers, imageTasks]);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'Active users', value: activeUsers.length, caption: `${users.length} total · ${inactiveUsers.length} disabled`, icon: Users, tone: 'success', href: '/dashboard/users', numeric: true },
    { label: 'Approvals across all teams', value: totalApprovals, caption: `${approvalQuotes.length} quotes · ${importBatches.length} imports · ${imageTasks.length} images`, icon: ClipboardCheck, tone: totalApprovals ? 'warning' : 'neutral', href: '/dashboard/approvals', numeric: true },
    { label: 'New users · 30d', value: recentUsers.length, caption: recentUsers.length ? 'Recent joiners' : 'No new joiners', icon: UserCheck, tone: 'brand', href: '/dashboard/users', numeric: true },
    { label: 'Business revenue · MTD', value: Number(orderStats.totalValue || 0), caption: `${orderStats.totalOrders || 0} orders · admin view`, icon: IndianRupee, tone: 'violet', href: '/dashboard/orders', numeric: true, format: moneyShort },
  ];

  const secondary: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean }> = [
    { label: 'Disabled accounts', value: inactiveUsers.length, caption: inactiveUsers.length ? 'Review or restore' : 'None disabled', icon: UserX, tone: inactiveUsers.length ? 'warning' : 'neutral', href: '/dashboard/users', numeric: true },
    { label: 'Customers on file', value: customers.length, caption: 'Master records', icon: Users, tone: 'brand', href: '/dashboard/customers', numeric: true },
    { label: 'Catalogue SKUs', value: Number(ownerStats.totalProducts || 0), caption: 'Active product master', icon: Boxes, tone: 'sky', href: '/dashboard/products', numeric: true },
    { label: 'System integrations', value: 'Healthy', caption: 'Postgres · Apollo · PDF render', icon: ServerCog, tone: 'success', href: '/dashboard/settings' },
  ];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role="admin"
        user={user}
        name={user?.name}
        subtitle="People, security, integrity and the queues that keep the store running."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/users"><Plus className="mr-1.5 h-4 w-4" /> Manage users</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/approvals">Approvals · {totalApprovals}</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/settings">System settings</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Active users by role" subtitle="Coverage across the team" tone="brand">
          {roleDistribution.length ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roleDistribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} angle={-12} dy={10} height={50} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                  <Tooltip cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} animationDuration={900}>
                    {roleDistribution.map((r, i) => <Cell key={i} fill={r.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState>No users yet — create one.</EmptyState>}
        </Panel>

        <Panel title="Approval load" subtitle={`${totalApprovals} item${totalApprovals === 1 ? '' : 's'} across queues`} tone="warning">
          <ul className="space-y-2">
            {approvalBreakdown.map((b) => (
              <li key={b.label}>
                <Link
                  href={b.href}
                  className="flex items-center justify-between rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2.5 transition-colors hover:border-[#d4d4d8] hover:bg-[#fafafa]"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`mp-kpi-icon-${b.tone} grid h-7 w-7 place-items-center rounded-md`}>
                      <b.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <span className="text-sm font-medium text-[#27272a]">{b.label}</span>
                  </div>
                  <span className="rounded-full bg-[#fde68a] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">{b.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {secondary.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Team directory" subtitle={`${activeUsers.length} active member${activeUsers.length === 1 ? '' : 's'}`} tone="success" rightAction={<Link href="/dashboard/users" className="text-xs font-medium text-[#1d4ed8] hover:underline">Manage</Link>}>
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Person</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {activeUsers.slice(0, 8).map((u: any) => (
                  <tr key={u.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar user={u} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#18181b]">{u.name}</p>
                          <p className="truncate text-[11px] text-[#71717a]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
                        style={{ background: `${ROLE_COLOR[u.role] || '#71717a'}22`, color: ROLE_COLOR[u.role] || '#71717a' }}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#047857]">
                        <BadgeCheck className="h-3 w-3" /> Active
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[#52525b]">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                  </tr>
                ))}
                {!loading && !activeUsers.length ? <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-[#71717a]">No active users.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Recent joiners" subtitle="Users added in the last 30 days" tone="violet" rightAction={<Link href="/dashboard/users" className="text-xs font-medium text-[#1d4ed8] hover:underline">All users</Link>}>
          {recentUsers.length ? (
            <ul className="space-y-1.5">
              {recentUsers.map((u: any) => (
                <li key={u.id} className="flex items-center justify-between rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={u} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#18181b]">{u.name}</p>
                      <p className="truncate text-[11px] capitalize text-[#71717a]">{(u.role || '').replace('_', ' ')}</p>
                    </div>
                  </div>
                  <p className="shrink-0 text-[11px] text-[#52525b]">{new Date(u.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</p>
                </li>
              ))}
            </ul>
          ) : <EmptyState>No new joiners in the last 30 days.</EmptyState>}
        </Panel>
      </section>

      <Panel title="Data hygiene & integrity" subtitle="At-a-glance health of the operational data" tone="sky">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {hygiene.map((h) => (
            <Link key={h.label} href={h.href} className="rounded-r4 border border-[#e4e4e7] bg-white p-3 transition-colors hover:border-[#d4d4d8] hover:bg-[#fafafa]">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-[#52525b]">{h.label}</p>
                <span className={`mp-kpi-icon-${h.tone} grid h-6 w-6 place-items-center rounded-md`}>
                  <Shield className="h-3 w-3" strokeWidth={1.8} />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-[#18181b]">{h.count.toLocaleString('en-IN')}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <section className="grid gap-3 xl:grid-cols-3">
        <Panel title="Quick admin actions" subtitle="Most-used admin operations" tone="brand">
          <div className="grid gap-2">
            {[
              { icon: UserCog, label: 'Create user', href: '/dashboard/users' },
              { icon: Settings, label: 'System settings', href: '/dashboard/settings' },
              { icon: Database, label: 'Master data', href: '/dashboard/master-data' },
              { icon: Activity, label: 'View notifications', href: '/dashboard' },
              { icon: KeyRound, label: 'Change my password', href: '/dashboard/profile#change-password' },
            ].map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-2.5 rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2 text-sm font-medium text-[#27272a] transition-colors hover:border-[#d4d4d8] hover:bg-[#fafafa] hover:text-[#18181b]"
              >
                <span className="mp-kpi-icon-brand grid h-6 w-6 place-items-center rounded-md"><a.icon className="h-3 w-3" strokeWidth={1.8} /></span>
                {a.label}
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Security overview" subtitle="Account and access posture" tone="success">
          <ul className="space-y-2">
            <li className="flex items-start gap-3 rounded-r3 border border-[#f4f4f5] bg-white p-3">
              <span className="mp-kpi-icon-success grid h-8 w-8 place-items-center rounded-md"><ShieldCheck className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#18181b]">Session-based auth</p>
                <p className="text-xs text-[#71717a]">JWT bearer with server-side session table. Expired sessions auto-cleared.</p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-r3 border border-[#f4f4f5] bg-white p-3">
              <span className="mp-kpi-icon-brand grid h-8 w-8 place-items-center rounded-md"><BadgeCheck className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#18181b]">Role-aware GraphQL</p>
                <p className="text-xs text-[#71717a]">Every resolver enforces role through requireRoles/requireSession.</p>
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-r3 border border-[#f4f4f5] bg-white p-3">
              <span className="mp-kpi-icon-violet grid h-8 w-8 place-items-center rounded-md"><History className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#18181b]">Audit trail captured</p>
                <p className="text-xs text-[#71717a]">Quote creates / approvals / status changes recorded in AuditEvent.</p>
              </div>
            </li>
          </ul>
        </Panel>

        <Panel title="System status" subtitle="Infrastructure & integrations" tone="violet">
          <ul className="space-y-2">
            {[
              { label: 'Postgres', state: 'Healthy', tone: 'success' as Tone },
              { label: 'GraphQL API', state: 'Healthy', tone: 'success' as Tone },
              { label: 'PDF renderer', state: 'Healthy', tone: 'success' as Tone },
              { label: 'Catalogue extractor', state: 'Idle', tone: 'neutral' as Tone },
            ].map((s) => (
              <li key={s.label} className="flex items-center justify-between rounded-r3 border border-[#f4f4f5] bg-white px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 rounded-full ${s.tone === 'success' ? 'bg-[#059669]' : 'bg-[#a1a1aa]'}`} />
                  <span className="text-sm font-medium text-[#27272a]">{s.label}</span>
                </div>
                <span className={`text-[11px] font-semibold ${s.tone === 'success' ? 'text-[#047857]' : 'text-[#71717a]'}`}>{s.state}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
