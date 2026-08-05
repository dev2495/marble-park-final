'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { BellRing, Download, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

const ME = gql`
  query StockAlertPolicyMe {
    me { id role }
  }
`;

const POLICIES = gql`
  query StockAlertPolicies($search: String, $category: String, $brand: String, $alertState: String, $cursor: String, $take: Int) {
    stockAlertPolicies(search: $search, category: $category, brand: $brand, alertState: $alertState, cursor: $cursor, take: $take)
  }
`;

const FILTERS = gql`
  query StockAlertPolicyFilters {
    productCategories
    productBrands
  }
`;

const UPDATE_ONE = gql`
  mutation UpdateStockAlertPolicy($id: ID!, $input: UpdateInventoryInput!) {
    updateInventory(id: $id, input: $input) {
      id
      available
      lowStockThreshold
      criticalStockThreshold
      alertState
      isLowStock
      product { id sku name brand category }
    }
  }
`;

const BULK_UPDATE = gql`
  mutation BulkUpdateStockAlertPolicies($input: [StockAlertPolicyRowInput!]!) {
    bulkUpdateStockAlertPolicies(input: $input)
  }
`;

const ALERT_CHIPS = [
  { value: '', label: 'All' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'off', label: 'Alerts off' },
] as const;

function qty(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('en-IN');
}

function badgeClass(state: string) {
  if (state === 'critical') return 'bg-[var(--crit-50,#fef2f2)] text-[var(--crit-700,#b91c1c)]';
  if (state === 'warning') return 'bg-[var(--warn-50,#fffbeb)] text-[var(--warn-700,#b45309)]';
  if (state === 'healthy') return 'bg-[var(--ok-50,#ecfdf5)] text-[var(--ok-700,#047857)]';
  return 'bg-[#f4f4f5] text-[#52525b]';
}

function badgeLabel(state: string) {
  if (state === 'critical') return 'Critical';
  if (state === 'warning') return 'Warning';
  if (state === 'healthy') return 'Healthy';
  return 'Off';
}

type Draft = { warning: string; critical: string };

export default function StockAlertPolicyPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [alertState, setAlertState] = useState('');
  const [cursor, setCursor] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [bulkWarning, setBulkWarning] = useState('5');
  const [bulkCritical, setBulkCritical] = useState('2');
  const [savingId, setSavingId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const { data: meData, loading: meLoading } = useQuery(ME);
  const role = meData?.me?.role || '';
  const allowed = role === 'admin' || role === 'owner';

  useEffect(() => {
    try {
      const sku = new URLSearchParams(window.location.search).get('sku');
      if (sku) setSearch(sku);
    } catch { /* ignore */ }
  }, []);

  const { data, loading, error, refetch, fetchMore } = useQuery(POLICIES, {
    skip: !allowed,
    variables: {
      search: deferredSearch || undefined,
      category: category || undefined,
      brand: brand || undefined,
      alertState: alertState || undefined,
      take: 50,
    },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });
  const { data: filterData } = useQuery(FILTERS, { skip: !allowed });
  const [updateOne] = useMutation(UPDATE_ONE);
  const [bulkUpdate, { loading: bulkSaving }] = useMutation(BULK_UPDATE);

  const payload = data?.stockAlertPolicies || { items: [], summary: {}, nextCursor: null };
  const summary = payload.summary || {};
  const categories = useMemo<string[]>(() => (filterData?.productCategories || []).filter(Boolean).sort(), [filterData?.productCategories]);
  const brands = useMemo<string[]>(() => (filterData?.productBrands || []).filter(Boolean).sort(), [filterData?.productBrands]);

  useEffect(() => {
    if (meLoading) return;
    if (meData?.me && !allowed) router.replace('/dashboard/inventory');
  }, [meLoading, meData, allowed, router]);

  useEffect(() => {
    if (!cursor && !loading) {
      const items = payload.items || [];
      setRows(items);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const row of items) {
          if (!next[row.id]) {
            next[row.id] = {
              warning: String(row.lowStockThreshold ?? 0),
              critical: String(row.criticalStockThreshold ?? 0),
            };
          }
        }
        return next;
      });
    }
  }, [payload.items, cursor, loading]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allSelected = rows.length > 0 && rows.every((row) => selected[row.id]);

  const resetPage = (fn: () => void) => {
    setCursor('');
    setRows([]);
    setSelected({});
    fn();
  };

  const loadMore = async () => {
    if (!payload.nextCursor || loading) return;
    const result = await fetchMore({ variables: { cursor: payload.nextCursor } });
    const nextRows = result.data?.stockAlertPolicies?.items || [];
    setRows((current) => {
      const merged = [...current];
      for (const row of nextRows) {
        if (!merged.some((existing) => existing.id === row.id)) merged.push(row);
      }
      return merged;
    });
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of nextRows) {
        if (!next[row.id]) {
          next[row.id] = {
            warning: String(row.lowStockThreshold ?? 0),
            critical: String(row.criticalStockThreshold ?? 0),
          };
        }
      }
      return next;
    });
    setCursor(payload.nextCursor);
  };

  const parseThreshold = (value: string) => Math.max(0, Math.trunc(Number(value || 0)) || 0);

  const saveRow = async (row: any) => {
    const draft = drafts[row.id] || { warning: String(row.lowStockThreshold ?? 0), critical: String(row.criticalStockThreshold ?? 0) };
    setSavingId(row.id);
    try {
      const result = await updateOne({
        variables: {
          id: row.id,
          input: {
            lowStockThreshold: parseThreshold(draft.warning),
            criticalStockThreshold: parseThreshold(draft.critical),
          },
        },
      });
      const updated = result.data?.updateInventory;
      if (updated) {
        setRows((current) => current.map((item) => (item.id === row.id ? { ...item, ...updated } : item)));
        setDrafts((prev) => ({
          ...prev,
          [row.id]: {
            warning: String(updated.lowStockThreshold ?? 0),
            critical: String(updated.criticalStockThreshold ?? 0),
          },
        }));
      }
      await refetch();
    } finally {
      setSavingId(null);
    }
  };

  const saveSelected = async () => {
    if (!selectedIds.length) return;
    const input = selectedIds.map((id) => {
      const row = rows.find((item) => item.id === id);
      const draft = drafts[id] || {
        warning: String(row?.lowStockThreshold ?? 0),
        critical: String(row?.criticalStockThreshold ?? 0),
      };
      return {
        balanceId: id,
        lowStockThreshold: parseThreshold(draft.warning),
        criticalStockThreshold: parseThreshold(draft.critical),
      };
    });
    await bulkUpdate({ variables: { input } });
    setCursor('');
    setRows([]);
    await refetch();
  };

  const applyBulk = async () => {
    if (!selectedIds.length) return;
    const warning = parseThreshold(bulkWarning);
    const critical = parseThreshold(bulkCritical);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = { warning: String(warning), critical: String(critical) };
      return next;
    });
    await bulkUpdate({
      variables: {
        input: selectedIds.map((id) => ({
          balanceId: id,
          lowStockThreshold: warning,
          criticalStockThreshold: critical,
        })),
      },
    });
    setCursor('');
    setRows([]);
    await refetch();
  };

  const exportCsv = () => {
    const cells = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      ['SKU', 'Product', 'Brand', 'Category', 'Available', 'Warning', 'Critical', 'Status'],
      ...rows.map((row) => {
        const draft = drafts[row.id] || { warning: row.lowStockThreshold, critical: row.criticalStockThreshold };
        return [
          row.product?.sku,
          row.product?.name,
          row.product?.brand,
          row.product?.category,
          row.available,
          draft.warning,
          draft.critical,
          row.alertState,
        ];
      }),
    ].map((line) => line.map(cells).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'marble-park-stock-alert-policy.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (meLoading || (meData?.me && !allowed)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm font-semibold text-[var(--ink-4)]">
        {meLoading ? 'Checking access…' : 'Redirecting…'}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <section className="mp-card rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-7 shadow-md-soft">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Stock · Alert policy</p>
        <h1 className="mt-2 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">
          Set warning &amp; critical levels for every SKU.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
          Owner and admin only. Warning fires when available stock is close to empty; critical fires on breach.
          Inventory managers still receive bell alerts so they can reorder.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['SKUs tracked', summary.tracked, 'text-[var(--ink)]'],
            ['Warning now', summary.warning, 'text-[var(--warn-700,#b45309)]'],
            ['Critical now', summary.critical, 'text-[var(--crit-700,#b91c1c)]'],
            ['Alerts off', summary.off, 'text-[var(--ink)]'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-2xl border border-[var(--line)] bg-[#fafafa] px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ink-5)]">{label}</span>
              <b className={cn('mt-1.5 block text-3xl font-bold tracking-[-0.03em]', tone)}>
                {loading && !rows.length ? '…' : qty(Number(value || 0))}
              </b>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => resetPage(() => setSearch(e.target.value))}
            placeholder="Search SKU, name, brand…"
            className="h-[42px] min-w-[240px] rounded-xl border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-[var(--brand-500)]"
          />
          <select
            value={category}
            onChange={(e) => resetPage(() => setCategory(e.target.value))}
            className="h-[42px] rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            value={brand}
            onChange={(e) => resetPage(() => setBrand(e.target.value))}
            className="h-[42px] rounded-xl border border-[var(--line)] bg-white px-3 text-sm"
          >
            <option value="">All brands</option>
            {brands.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {ALERT_CHIPS.map((chip) => (
            <button
              key={chip.value || 'all'}
              type="button"
              onClick={() => resetPage(() => setAlertState(chip.value))}
              className={cn(
                'h-9 rounded-full border border-[var(--line)] bg-white px-3.5 text-xs font-extrabold uppercase tracking-[0.06em]',
                alertState === chip.value && 'border-[var(--ink)] bg-[var(--ink)] text-white',
              )}
            >
              {chip.label}
            </button>
          ))}
          <div className="flex-1" />
          <Button type="button" variant="outline" className="h-[42px] rounded-xl" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button
            type="button"
            className="h-[42px] rounded-xl bg-[var(--brand-700)] text-white hover:bg-[var(--brand-700)]/90"
            disabled={!selectedIds.length || bulkSaving}
            onClick={() => void saveSelected()}
          >
            {bulkSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save selected
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--brand-50)] px-4 py-3">
          <strong className="text-sm text-[var(--ink)]">Bulk apply to selected</strong>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-4)]">
            Warning
            <input
              type="number"
              min={0}
              value={bulkWarning}
              onChange={(e) => setBulkWarning(e.target.value)}
              className="h-9 w-[88px] rounded-lg border border-[var(--line)] bg-white px-2 text-right text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-4)]">
            Critical
            <input
              type="number"
              min={0}
              value={bulkCritical}
              onChange={(e) => setBulkCritical(e.target.value)}
              className="h-9 w-[88px] rounded-lg border border-[var(--line)] bg-white px-2 text-right text-sm"
            />
          </label>
          <Button
            type="button"
            className="h-9 rounded-xl bg-[var(--brand-700)] text-white"
            disabled={!selectedIds.length || bulkSaving}
            onClick={() => void applyBulk()}
          >
            Apply
          </Button>
          <span className="text-xs text-[var(--ink-4)]">0 disables that tier for the selected rows. {selectedIds.length} selected.</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[#fafafa] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--ink-4)]">
                <th className="px-4 py-3.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => {
                      const next: Record<string, boolean> = {};
                      if (e.target.checked) for (const row of rows) next[row.id] = true;
                      setSelected(next);
                    }}
                    aria-label="Select all rows"
                  />
                </th>
                <th className="px-4 py-3.5">SKU / product</th>
                <th className="px-4 py-3.5">Available</th>
                <th className="px-4 py-3.5">Warning</th>
                <th className="px-4 py-3.5">Critical</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm font-semibold text-[var(--ink-4)]">Loading policies…</td></tr>
              ) : null}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <BellRing className="mx-auto h-8 w-8 text-[var(--brand-600)]" />
                    <p className="mt-3 font-semibold text-[var(--ink)]">No SKUs match this filter.</p>
                    <p className="mt-1 text-sm text-[var(--ink-4)]">Clear filters or open the inventory tower to add balances.</p>
                    <Link href="/dashboard/inventory" className="mt-3 inline-block text-sm font-semibold text-[var(--brand-700)]">Inventory tower</Link>
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => {
                const draft = drafts[row.id] || {
                  warning: String(row.lowStockThreshold ?? 0),
                  critical: String(row.criticalStockThreshold ?? 0),
                };
                return (
                  <tr key={row.id} className="border-b border-[#f1f1f3] hover:bg-[#fcfcfd]">
                    <td className="px-4 py-3.5 align-middle">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[row.id])}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                        aria-label={`Select ${row.product?.sku || row.id}`}
                      />
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <div className="font-bold text-[var(--ink)]">{row.product?.sku || '—'}</div>
                      <div className="mt-0.5 text-xs text-[var(--ink-4)]">
                        {row.product?.name || 'Product'} · {row.product?.brand || '—'} · {row.product?.category || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <div className="text-lg font-extrabold text-[var(--ink)]">{qty(row.available)}</div>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <input
                        type="number"
                        min={0}
                        value={draft.warning}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, warning: e.target.value } }))}
                        className="h-9 w-[88px] rounded-lg border border-[var(--line)] bg-white px-2 text-right text-sm"
                      />
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <input
                        type="number"
                        min={0}
                        value={draft.critical}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, critical: e.target.value } }))}
                        className="h-9 w-[88px] rounded-lg border border-[var(--line)] bg-white px-2 text-right text-sm"
                      />
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <span className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 text-[11px] font-extrabold uppercase tracking-[0.04em]', badgeClass(row.alertState))}>
                        {badgeLabel(row.alertState)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-right">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl"
                        disabled={savingId === row.id}
                        onClick={() => void saveRow(row)}
                      >
                        {savingId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {payload.nextCursor ? (
          <div className="border-t border-[var(--line)] p-4 text-center">
            <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
