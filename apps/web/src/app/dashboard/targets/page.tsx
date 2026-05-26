'use client';

import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Target, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const ME = gql`query { me { id role } }`;
const USERS = gql`query { users { id name role } }`;
const MY_PROGRESS = gql`query MyProgress($month: String) { mySalesTargetProgress(month: $month) }`;
const TARGETS_FOR_MONTH = gql`query TargetsForMonth($month: String!) { salesTargetsForMonth(month: $month) { id userId amount notes } }`;
const SET_TARGET = gql`mutation SetTarget($input: SetTargetInputDto!) { setSalesTarget(input: $input) { id } }`;

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function TargetsPage() {
  const [month, setMonth] = useState(currentMonth());
  const { data: meData } = useQuery(ME);
  const { data: usersData } = useQuery(USERS);
  const { data: myProgressData, refetch: refetchProgress } = useQuery(MY_PROGRESS, { variables: { month } });
  const { data: monthlyData, refetch: refetchMonthly, error: monthlyError } = useQuery(TARGETS_FOR_MONTH, { variables: { month }, skip: !meData?.me });
  const [setTargetMutation, { loading: saving, error: saveError }] = useMutation(SET_TARGET, {
    onCompleted: () => {
      refetchProgress();
      refetchMonthly();
    },
  });

  const role = meData?.me?.role || '';
  const canSet = ['owner', 'admin', 'sales_manager'].includes(role);

  const users: any[] = useMemo(() => usersData?.users || [], [usersData]);
  const targetMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const t of monthlyData?.salesTargetsForMonth || []) {
      map.set(t.userId, t);
    }
    return map;
  }, [monthlyData]);

  const myProgress = myProgressData?.mySalesTargetProgress;
  const myPercent = Number(myProgress?.percent || 0);

  const [targets, setTargets] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [userId, t] of targetMap) next[userId] = String(t.amount || '');
    setTargets(next);
  }, [targetMap]);

  const saveAll = async () => {
    for (const u of users) {
      const amountStr = targets[u.id];
      if (amountStr === undefined || amountStr === '') continue;
      const amount = Number(amountStr);
      if (Number.isNaN(amount) || amount < 0) continue;
      await setTargetMutation({ variables: { input: { userId: u.id, month, amount } } });
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-r5 border border-[var(--line)] bg-gradient-to-br from-violet-50 via-white to-violet-50/40 p-6 shadow-sm-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-violet-700">Sales targets</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--ink)]">Monthly target tracker</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--ink-3)]">
              Set per-rep targets and watch live progress against confirmed sales orders.
            </p>
          </div>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} className="max-w-[12rem]" />
        </div>

        {myProgress ? (
          <div className="mt-5 rounded-r4 border border-[var(--line)] bg-white/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">My target this month</p>
                <p className="mt-1 text-2xl font-bold text-[var(--ink)]">₹{Number(myProgress.targetAmount || 0).toLocaleString('en-IN')}</p>
                <p className="text-xs text-[var(--ink-3)]">Achieved ₹{Number(myProgress.achievedAmount || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-violet-700">{myPercent.toFixed(0)}%</p>
                <p className="text-xs text-[var(--ink-3)]">of target</p>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-soft)]">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, myPercent)}%` }} />
            </div>
            {!myProgress.hasTarget ? <p className="mt-2 text-xs text-[var(--ink-4)]">No target has been set for you yet.</p> : null}
          </div>
        ) : null}
      </section>

      {monthlyError && !monthlyData ? <QueryErrorBanner error={monthlyError} onRetry={() => refetchMonthly()} /> : null}

      {canSet ? (
        <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--ink)]">Team targets</h2>
            <Button onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save all'}</Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--line)] text-left text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                <tr>
                  <th className="py-2">Sales rep</th>
                  <th>Role</th>
                  <th className="text-right">Target (₹)</th>
                </tr>
              </thead>
              <tbody>
                {users.filter((u) => ['sales', 'sales_manager'].includes(u.role)).map((u) => (
                  <tr key={u.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 text-sm font-semibold text-[var(--ink)]">{u.name}</td>
                    <td className="text-xs uppercase tracking-widest text-[var(--ink-4)]">{u.role.replace('_', ' ')}</td>
                    <td className="text-right">
                      <Input type="number" min="0" value={targets[u.id] || ''} onChange={(e) => setTargets({ ...targets, [u.id]: e.target.value })} className="max-w-[12rem] ml-auto text-right" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {saveError ? <div className="mt-3"><QueryErrorBanner error={saveError} /></div> : null}
        </section>
      ) : (
        <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-6 text-center shadow-sm-soft">
          <Target className="mx-auto h-6 w-6 text-[var(--ink-4)]" />
          <p className="mt-2 text-sm font-semibold text-[var(--ink-2)]">Only sales managers, admins, and the owner can set targets.</p>
        </section>
      )}
    </div>
  );
}
