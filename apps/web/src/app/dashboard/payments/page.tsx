'use client';

import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client';
import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Banknote, CalendarClock, Check, ChevronRight, CircleDollarSign,
  ClipboardCheck, FileCheck2, FileText, Landmark, Loader2, Plus, Receipt, RefreshCw, Search,
  ShieldCheck, SlidersHorizontal, WalletCards, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';

const ACCOUNTS = gql`
  query CustomerAccountsDesk($search: String, $take: Int) {
    receivablesDashboard(search: $search, take: $take)
    invoiceableOrders(take: 80)
  }
`;

const CUSTOMER_ACCOUNT = gql`
  query CustomerAccountDesk($id: ID!) { customerAccount(customerId: $id) }
`;

const RECORD_PAYMENT = gql`
  mutation RecordCustomerPayment($input: CustomerPaymentInput!) { recordCustomerPayment(input: $input) }
`;

const ISSUE_INVOICE = gql`
  mutation IssueSalesInvoice($input: IssueSalesInvoiceInput!) { issueSalesInvoice(input: $input) }
`;

const ALLOCATE_PAYMENT = gql`
  mutation AllocateCustomerPayment($paymentId: ID!, $salesInvoiceId: ID!, $amount: Float!) {
    allocateCustomerPayment(paymentId: $paymentId, salesInvoiceId: $salesInvoiceId, amount: $amount)
  }
`;

const UPDATE_PROFILE = gql`
  mutation UpdateCreditProfile($customerId: ID!, $input: CustomerCreditProfileInput!) {
    updateCustomerCreditProfile(customerId: $customerId, input: $input)
  }
`;

const CREATE_TASK = gql`
  mutation CreateCollectionTask($input: CollectionTaskInput!) { createCollectionTask(input: $input) }
`;

const COMPLETE_TASK = gql`
  mutation CompleteCollectionTask($id: ID!, $outcome: String) { completeCollectionTask(id: $id, outcome: $outcome) }
`;

const money = (value: number | string | undefined | null) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const date = (value: string | undefined | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const isoToday = () => new Date().toISOString().slice(0, 10);

function tone(status: string) {
  if (['paid', 'posted', 'completed'].includes(status)) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (['partial', 'open'].includes(status)) return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (['void', 'overdue'].includes(status)) return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-[var(--bg-soft)] text-[var(--ink-3)] ring-[var(--line)]';
}

function Status({ value }: { value?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ${tone(value || '')}`}>{String(value || 'open').replaceAll('_', ' ')}</span>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[70] flex items-end bg-black/45 p-0 sm:items-center sm:justify-center sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
    <button className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
    <section className={`relative max-h-[92vh] w-full overflow-auto rounded-t-lg border border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:rounded-lg ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`}>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-5 py-4"><h2 className="font-display text-xl font-bold text-[var(--ink)]">{title}</h2><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md text-[var(--ink-3)] hover:bg-[var(--bg-soft)]" title="Close"><X className="h-5 w-5" /></button></header>
      <div className="p-5">{children}</div>
    </section>
  </div>;
}

export default function PaymentsPage() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'accounts' | 'queue' | 'cash'>('accounts');
  const [activeCustomer, setActiveCustomer] = useState<any>(null);
  const [paymentCustomer, setPaymentCustomer] = useState<any>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<any>(null);
  const [allocation, setAllocation] = useState<any>(null);
  const [profileEdit, setProfileEdit] = useState(false);
  const [followUpFor, setFollowUpFor] = useState<any>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const { data, loading, error, refetch } = useQuery(ACCOUNTS, { variables: { search: search || undefined, take: 180 }, fetchPolicy: 'network-only' });
  const [loadAccount, accountQuery] = useLazyQuery(CUSTOMER_ACCOUNT, { fetchPolicy: 'network-only' });
  const [recordPayment, paymentState] = useMutation(RECORD_PAYMENT);
  const [issueInvoice, invoiceState] = useMutation(ISSUE_INVOICE);
  const [allocatePayment, allocationState] = useMutation(ALLOCATE_PAYMENT);
  const [updateProfile, profileState] = useMutation(UPDATE_PROFILE);
  const [createTask, taskState] = useMutation(CREATE_TASK);
  const [completeTask] = useMutation(COMPLETE_TASK);
  const dashboard = data?.receivablesDashboard || {};
  const accounts: any[] = dashboard.accounts || [];
  const queue: any[] = dashboard.collectionQueue || [];
  const tasks: any[] = dashboard.tasks || [];
  const invoiceable: any[] = data?.invoiceableOrders || [];
  const account = accountQuery.data?.customerAccount;
  const kpis = dashboard.kpis || {};
  const recentPayments = useMemo(() => (account?.payments || []).slice(0, 8), [account]);

  async function openAccount(row: any) {
    setActionError(null); setProfileEdit(false); setActiveCustomer(row.customer);
    await loadAccount({ variables: { id: row.customer.id } }).catch((reason) => setActionError(reason instanceof Error ? reason : new Error('Could not load customer account.')));
  }

  async function startPayment(customer: any) {
    if (!customer?.id) return;
    setActionError(null);
    setActiveCustomer(customer);
    await loadAccount({ variables: { id: customer.id }, fetchPolicy: 'network-only' }).catch((reason) => {
      setActionError(reason instanceof Error ? reason : new Error('Could not load orders available for this receipt.'));
    });
    setPaymentCustomer(customer);
  }

  async function refreshAccount() {
    await refetch();
    if (activeCustomer?.id) await loadAccount({ variables: { id: activeCustomer.id }, fetchPolicy: 'network-only' });
  }

  async function submitPayment(form: FormData) {
    if (!paymentCustomer) return;
    setActionError(null);
    try {
      await recordPayment({ variables: { input: {
        customerId: paymentCustomer.id, salesOrderId: String(form.get('salesOrderId') || '') || null, salesInvoiceId: String(form.get('salesInvoiceId') || '') || null,
        paymentMode: String(form.get('paymentMode') || 'upi'), moneyAccount: String(form.get('moneyAccount') || 'bank'), amount: Number(form.get('amount') || 0),
        receivedAt: String(form.get('receivedAt') || '') || null, reference: String(form.get('reference') || ''), notes: String(form.get('notes') || ''), autoAllocate: form.get('autoAllocate') === 'on',
        idempotencyKey: `payment:${paymentCustomer.id}:${Date.now()}`,
      } } });
      setPaymentCustomer(null); await refreshAccount();
    } catch (reason: any) { setActionError(reason instanceof Error ? reason : new Error(reason?.message || 'Could not post payment.')); }
  }

  async function submitInvoice() {
    if (!invoiceDraft) return;
    const selected = invoiceDraft.lines.filter((line: any) => line.selected).map((line: any) => line.id);
    if (!selected.length) { setActionError(new Error('Select at least one dispatched line to invoice.')); return; }
    setActionError(null);
    try {
      await issueInvoice({ variables: { input: { salesOrderId: invoiceDraft.salesOrderId, dispatchLineIds: selected, dueDate: invoiceDraft.dueDate || null, notes: invoiceDraft.notes || '', idempotencyKey: `invoice:${invoiceDraft.salesOrderId}:${selected.sort().join(':')}` } } });
      setInvoiceDraft(null); await refreshAccount();
    } catch (reason: any) { setActionError(reason instanceof Error ? reason : new Error(reason?.message || 'Could not post invoice.')); }
  }

  async function submitAllocation(form: FormData) {
    if (!allocation) return;
    setActionError(null);
    try {
      await allocatePayment({ variables: { paymentId: allocation.id, salesInvoiceId: String(form.get('salesInvoiceId') || ''), amount: Number(form.get('amount') || 0) } });
      setAllocation(null); await refreshAccount();
    } catch (reason: any) { setActionError(reason instanceof Error ? reason : new Error(reason?.message || 'Could not allocate payment.')); }
  }

  async function saveProfile(form: FormData) {
    if (!activeCustomer) return;
    setActionError(null);
    try {
      await updateProfile({ variables: { customerId: activeCustomer.id, input: { creditLimit: Number(form.get('creditLimit') || 0), defaultPaymentTerms: String(form.get('terms') || ''), creditHold: form.get('creditHold') === 'on', holdReason: String(form.get('holdReason') || '') } } });
      setProfileEdit(false); await refreshAccount();
    } catch (reason: any) { setActionError(reason instanceof Error ? reason : new Error(reason?.message || 'Could not save credit control.')); }
  }

  async function saveFollowUp(form: FormData) {
    if (!followUpFor) return;
    setActionError(null);
    try {
      await createTask({ variables: { input: { customerId: followUpFor.customerId || followUpFor.customer?.id, salesInvoiceId: followUpFor.id || null, priority: String(form.get('priority') || 'normal'), dueAt: String(form.get('dueAt') || '') || null, note: String(form.get('note') || '') } } });
      setFollowUpFor(null); await refreshAccount();
    } catch (reason: any) { setActionError(reason instanceof Error ? reason : new Error(reason?.message || 'Could not save follow-up.')); }
  }

  return <div className="space-y-5 pb-10">
    <header className="border-b border-[var(--line)] pb-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--brand-700)]">Collections desk</p><h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">Customer accounts, not just receipts.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Invoice dispatched value, record verified collections, allocate advances, and follow every outstanding balance through one account trail.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => startPayment(accounts[0]?.customer)} disabled={!accounts.length}><Plus className="mr-2 h-4 w-4" />Record payment</Button></div>
      </div>
    </header>

    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {actionError ? <QueryErrorBanner error={actionError} onRetry={() => setActionError(null)} /> : null}
    {loading && !data ? <QueryLoading label="Loading customer accounts..." /> : null}

    <section className="grid gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 xl:grid-cols-5">
      {[
        ['Receivable', money(kpis.receivable), 'Open customer balances', Landmark],
        ['Overdue', money(kpis.overdue), 'Requires collection action', AlertTriangle],
        ['Collected this month', money(kpis.currentMonthCollections), 'Posted receipts', Banknote],
        ['Billed this month', money(kpis.currentMonthBilling), 'Dispatch-backed invoices', FileCheck2],
        ['Unallocated credit', money(kpis.unappliedCredit), 'Advance available to apply', WalletCards],
      ].map(([label, value, note, Icon]: any) => <div key={label} className="min-h-36 bg-[var(--surface)] p-4"><Icon className="h-5 w-5 text-[var(--brand-700)]" /><p className="mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-4)]">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-[var(--ink)]">{value}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{note}</p></div>)}
    </section>

    <section className="flex flex-col gap-3 border-b border-[var(--line)] pb-3 md:flex-row md:items-center md:justify-between">
      <div className="flex gap-1" role="tablist">{[['accounts', 'Accounts'], ['queue', `Collections queue ${queue.length ? `(${queue.length})` : ''}`], ['cash', 'Cash book']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key as any)} className={`border-b-2 px-3 py-2 text-sm font-bold transition ${tab === key ? 'border-[var(--brand-700)] text-[var(--brand-700)]' : 'border-transparent text-[var(--ink-4)] hover:text-[var(--ink)]'}`}>{label}</button>)}</div>
      <label className="relative block md:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Find customer, mobile or city" /></label>
    </section>

    {tab === 'accounts' ? <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="hidden grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.45fr] gap-4 border-b border-[var(--line)] bg-[var(--bg-soft)] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)] lg:grid"><span>Customer</span><span className="text-right">Receivable</span><span className="text-right">Overdue</span><span>Next action</span><span /></div>
      <div className="divide-y divide-[var(--line)]">{accounts.map((row) => <article key={row.customerId} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr_0.45fr] lg:items-center"><div><div className="flex items-center gap-2"><p className="font-bold text-[var(--ink)]">{row.customer.name}</p>{row.profile?.creditHold ? <ShieldCheck className="h-4 w-4 text-rose-600" /> : null}</div><p className="mt-1 text-xs text-[var(--ink-4)]">{[row.customer.mobile, row.customer.city].filter(Boolean).join(' · ') || 'Customer account'}</p></div><div className="text-right"><p className="font-bold tabular-nums text-[var(--ink)]">{money(row.balance)}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{money(row.unallocatedCredit)} available credit</p></div><div className="text-right"><p className={`font-bold tabular-nums ${Number(row.overdue) > 0 ? 'text-rose-700' : 'text-[var(--ink-3)]'}`}>{money(row.overdue)}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.openTaskCount} open follow-up{row.openTaskCount === 1 ? '' : 's'}</p></div><div><p className="text-sm font-semibold text-[var(--ink-2)]">{row.nextDueDate ? `Due ${date(row.nextDueDate)}` : 'No invoice due'}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{row.profile?.creditHold ? row.profile.holdReason || 'Credit hold' : row.profile?.defaultPaymentTerms || 'No default terms'}</p></div><div className="flex justify-end gap-1"><button onClick={() => startPayment(row.customer)} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] text-[var(--brand-700)] hover:bg-[var(--bg-soft)]" title="Record payment"><Receipt className="h-4 w-4" /></button><button onClick={() => openAccount(row)} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg-soft)]" title="Open customer account"><ChevronRight className="h-4 w-4" /></button></div></article>)}{!accounts.length && !loading ? <p className="px-5 py-12 text-center text-sm text-[var(--ink-4)]">No customer account balances match this view.</p> : null}</div>
    </section> : null}

    {tab === 'queue' ? <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4"><div><h2 className="font-bold text-[var(--ink)]">Outstanding invoices</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Oldest due and highest balance are shown first.</p></div><span className="text-sm font-bold text-rose-700">{money(kpis.overdue)}</span></div><div className="divide-y divide-[var(--line)]">{queue.map((invoice) => <div key={invoice.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]"><div><p className="font-bold text-[var(--ink)]">{invoice.customer?.name || 'Customer'}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{invoice.invoiceNumber} · due {date(invoice.dueDate)} · {invoice.overdueDays} days overdue</p></div><p className="self-center text-right font-bold tabular-nums text-[var(--ink)]">{money(invoice.openAmount)}</p><div className="flex items-center justify-end gap-2"><a href={`/api/pdf/invoice/${invoice.id}`} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)]" title="Open invoice PDF"><FileText className="h-4 w-4" /></a><button onClick={() => setFollowUpFor(invoice)} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] text-[var(--brand-700)]" title="Schedule follow-up"><CalendarClock className="h-4 w-4" /></button></div></div>)}{!queue.length ? <p className="p-10 text-center text-sm text-[var(--ink-4)]">No outstanding invoices. Dispatch and post the first invoice to start the collection cycle.</p> : null}</div></div>
      <aside className="rounded-lg border border-[var(--line)] bg-[var(--surface)]"><div className="border-b border-[var(--line)] p-5"><h2 className="font-bold text-[var(--ink)]">Dispatch ready to invoice</h2><p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">Each line is shown once until a dispatch-backed invoice is posted.</p></div><div className="max-h-[30rem] divide-y divide-[var(--line)] overflow-auto">{invoiceable.map((order) => <button key={order.salesOrderId} onClick={() => setInvoiceDraft({ ...order, dueDate: isoToday(), notes: '', lines: order.lines.map((line: any) => ({ ...line, selected: true })) })} className="block w-full p-4 text-left hover:bg-[var(--bg-soft)]"><p className="font-bold text-[var(--ink)]">{order.orderNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{order.customer?.name || 'Customer'} · {order.lineCount} dispatched line{order.lineCount === 1 ? '' : 's'}</p></button>)}{!invoiceable.length ? <p className="p-8 text-center text-sm text-[var(--ink-4)]">No dispatched lines await invoicing.</p> : null}</div></aside></section> : null}

    {tab === 'cash' ? <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"><div className="border-b border-[var(--line)] p-5"><h2 className="font-bold text-[var(--ink)]">Recent receipts</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Open an account to allocate an advance or download its receipt.</p></div><div className="divide-y divide-[var(--line)]">{accounts.slice(0, 12).map((row) => <button key={row.customerId} onClick={() => openAccount(row)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[var(--bg-soft)]"><div><p className="font-bold text-[var(--ink)]">{row.customer.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">Credit held: {money(row.unallocatedCredit)}</p></div><ArrowUpRight className="h-4 w-4 text-[var(--ink-4)]" /></button>)}</div></div><div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5"><CircleDollarSign className="h-6 w-6 text-[var(--brand-700)]" /><h2 className="mt-5 font-bold text-[var(--ink)]">Posting controls</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">Every receipt requires a customer, payment mode, amount and posting date. It creates a credit in the account even when no invoice is selected, so advance money cannot disappear from the collection view.</p><Button className="mt-5" onClick={() => startPayment(accounts[0]?.customer)} disabled={!accounts.length}><Plus className="mr-2 h-4 w-4" />Post a receipt</Button></div></section> : null}

    {activeCustomer ? <Modal title={activeCustomer.name} onClose={() => { setActiveCustomer(null); setProfileEdit(false); }} wide>{accountQuery.loading && !account ? <QueryLoading label="Loading account trail..." /> : null}{account ? <CustomerAccountPanel account={account} recentPayments={recentPayments} onPayment={() => setPaymentCustomer(account.customer)} onAllocate={(payment: any) => setAllocation(payment)} onProfile={() => setProfileEdit(true)} onFollowUp={(invoice: any) => setFollowUpFor({ ...invoice, customerId: account.customer.id })} onComplete={async (task: any) => { await completeTask({ variables: { id: task.id, outcome: 'Completed from customer account.' } }); await refreshAccount(); }} /> : null}{profileEdit && account ? <CreditProfileForm account={account} busy={profileState.loading} onCancel={() => setProfileEdit(false)} onSubmit={saveProfile} /> : null}</Modal> : null}
    {paymentCustomer ? <PaymentFormWithOrder customer={paymentCustomer} account={activeCustomer?.id === paymentCustomer.id ? account : null} busy={paymentState.loading} onClose={() => setPaymentCustomer(null)} onSubmit={submitPayment} /> : null}
    {invoiceDraft ? <InvoiceReview draft={invoiceDraft} busy={invoiceState.loading} onClose={() => setInvoiceDraft(null)} onChange={setInvoiceDraft} onSubmit={submitInvoice} /> : null}
    {allocation ? <AllocationForm payment={allocation} account={account} busy={allocationState.loading} onClose={() => setAllocation(null)} onSubmit={submitAllocation} /> : null}
    {followUpFor ? <FollowUpForm item={followUpFor} busy={taskState.loading} onClose={() => setFollowUpFor(null)} onSubmit={saveFollowUp} /> : null}
  </div>;
}

function CustomerAccountPanel({ account, recentPayments, onPayment, onAllocate, onProfile, onFollowUp, onComplete }: any) {
  const summary = account.summary || {}; const aging = summary.aging || {};
  return <div className="space-y-5"><section className="grid gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">{[['Balance', money(summary.balance), Landmark], ['Open invoices', money(summary.openInvoices), FileCheck2], ['Customer credit', money(summary.unallocatedCredit), WalletCards], ['Credit limit', money(account.profile?.creditLimit), ShieldCheck]].map(([label, value, Icon]: any) => <div key={label} className="bg-[var(--surface)] p-4"><Icon className="h-4 w-4 text-[var(--brand-700)]" /><p className="mt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{label}</p><p className="mt-1 text-lg font-bold tabular-nums text-[var(--ink)]">{value}</p></div>)}</section>
    <div className="flex flex-wrap gap-2"><Button onClick={onPayment}><Receipt className="mr-2 h-4 w-4" />Record payment</Button><a href={`/api/pdf/customer-statement/${account.customer.id}`} target="_blank" rel="noreferrer"><Button variant="outline"><FileText className="mr-2 h-4 w-4" />Statement PDF</Button></a><Button variant="outline" onClick={onProfile}><SlidersHorizontal className="mr-2 h-4 w-4" />Credit control</Button></div>
    <section className="grid gap-3 sm:grid-cols-4">{[['Current', aging.current], ['1-30 days', aging.d1to30], ['31-60 days', aging.d31to60], ['61+ days', aging.d61plus]].map(([label, value]) => <div key={String(label)} className="border-l-2 border-[var(--brand-700)] bg-[var(--bg-soft)] px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]">{label}</p><p className="mt-1 font-bold tabular-nums text-[var(--ink)]">{money(Number(value || 0))}</p></div>)}</section>
    <section className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3"><div><h3 className="font-bold text-[var(--ink)]">Open invoices</h3><p className="mt-1 text-xs text-[var(--ink-4)]">Receivable from dispatched goods only.</p></div><span className="text-sm font-bold text-[var(--ink)]">{money(summary.openInvoices)}</span></div><div className="divide-y divide-[var(--line)]">{(account.invoices || []).filter((invoice: any) => Number(invoice.openAmount || 0) > 0).map((invoice: any) => <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-bold text-[var(--ink)]">{invoice.invoiceNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">Due {date(invoice.dueDate)} · {invoice.status}</p></div><div className="flex items-center gap-2"><span className="font-bold tabular-nums text-[var(--ink)]">{money(invoice.openAmount)}</span><a href={`/api/pdf/invoice/${invoice.id}`} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)]" title="Invoice PDF"><FileText className="h-4 w-4" /></a><button onClick={() => onFollowUp(invoice)} className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-[var(--brand-700)]" title="Follow up"><CalendarClock className="h-4 w-4" /></button></div></div>)}{!(account.invoices || []).filter((invoice: any) => Number(invoice.openAmount || 0) > 0).length ? <p className="p-6 text-center text-sm text-[var(--ink-4)]">No open invoices.</p> : null}</div></section>
    <section className="grid gap-5 lg:grid-cols-2"><div className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3"><h3 className="font-bold text-[var(--ink)]">Receipts and advances</h3></div><div className="divide-y divide-[var(--line)]">{recentPayments.map((payment: any) => <div key={payment.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-bold text-[var(--ink)]">{payment.receiptNumber}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{String(payment.paymentMode || '').toUpperCase()} · {date(payment.receivedAt)}</p></div><div className="flex items-center gap-2"><div className="text-right"><p className="font-bold tabular-nums text-[var(--ink)]">{money(payment.amount)}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{money(payment.unappliedAmount)} free</p></div><a href={`/api/pdf/receipt/${payment.id}`} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-[var(--ink-3)]" title="Receipt PDF"><FileText className="h-4 w-4" /></a>{Number(payment.unappliedAmount) > 0 ? <button onClick={() => onAllocate(payment)} className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-[var(--brand-700)]" title="Allocate advance"><ArrowUpRight className="h-4 w-4" /></button> : null}</div></div>)}{!recentPayments.length ? <p className="p-6 text-center text-sm text-[var(--ink-4)]">No receipts posted.</p> : null}</div></div>
      <div className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3"><h3 className="font-bold text-[var(--ink)]">Follow-up log</h3></div><div className="divide-y divide-[var(--line)]">{(account.tasks || []).map((task: any) => <div key={task.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-semibold text-[var(--ink)]">{task.note || 'Collection follow-up'}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{task.priority} · due {date(task.dueAt)}</p></div>{task.status === 'open' ? <button onClick={() => onComplete(task)} className="grid h-8 w-8 place-items-center rounded-md border border-[var(--line)] text-emerald-700" title="Mark completed"><Check className="h-4 w-4" /></button> : <Status value={task.status} />}</div>)}{!(account.tasks || []).length ? <p className="p-6 text-center text-sm text-[var(--ink-4)]">No collection tasks yet.</p> : null}</div></div></section>
    <section className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="border-b border-[var(--line)] bg-[var(--bg-soft)] px-4 py-3"><h3 className="font-bold text-[var(--ink)]">Customer ledger</h3></div><div className="max-h-64 overflow-auto"><table className="w-full min-w-[600px] text-sm"><thead className="sticky top-0 bg-[var(--surface)] text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-4)]"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Document</th><th className="px-4 py-3">Narration</th><th className="px-4 py-3 text-right">Debit</th><th className="px-4 py-3 text-right">Credit</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{(account.ledger || []).map((entry: any) => <tr key={entry.id}><td className="px-4 py-3 text-[var(--ink-4)]">{date(entry.effectiveAt)}</td><td className="px-4 py-3"><Status value={entry.sourceLabel} /></td><td className="px-4 py-3 text-[var(--ink-2)]">{entry.narration}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(entry.debit) ? money(entry.debit) : '-'}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{Number(entry.credit) ? money(entry.credit) : '-'}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function PaymentForm({ customer, account, busy, onClose, onSubmit }: any) { return <Modal title={`Record payment · ${customer.name}`} onClose={onClose}><form action={onSubmit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[var(--ink-2)]">Amount<Input className="mt-1" name="amount" type="number" min="0.01" step="0.01" autoFocus required placeholder="0.00" /></label><label className="text-sm font-semibold text-[var(--ink-2)]">Received on<Input className="mt-1" name="receivedAt" type="date" defaultValue={isoToday()} required /></label><label className="text-sm font-semibold text-[var(--ink-2)]">Mode<select name="paymentMode" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="upi">UPI</option><option value="cash">Cash</option><option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label><label className="text-sm font-semibold text-[var(--ink-2)]">Account<select name="moneyAccount" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="bank">Bank</option><option value="cash_drawer">Cash drawer</option><option value="undeposited">Undeposited funds</option></select></label></div><label className="block text-sm font-semibold text-[var(--ink-2)]">Reference / UTR<Input className="mt-1" name="reference" placeholder="UPI reference, cheque number or bank UTR" /></label>{account?.invoices?.filter((row: any) => Number(row.openAmount) > 0).length ? <label className="block text-sm font-semibold text-[var(--ink-2)]">Apply to one invoice <span className="font-normal text-[var(--ink-4)]">(optional)</span><select name="salesInvoiceId" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Oldest open invoice automatically</option>{account.invoices.filter((row: any) => Number(row.openAmount) > 0).map((invoice: any) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {money(invoice.openAmount)}</option>)}</select></label> : null}<label className="block text-sm font-semibold text-[var(--ink-2)]">Note<textarea name="notes" className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" placeholder="Optional payment note" /></label><label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-2)]"><input type="checkbox" name="autoAllocate" defaultChecked />Allocate against oldest open invoice</label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}Post receipt</Button></div></form></Modal>; }

function PaymentFormWithOrder({ customer, account, busy, onClose, onSubmit }: any) {
  const orders = account?.salesOrders || [];
  const invoices = (account?.invoices || []).filter((row: any) => Number(row.openAmount) > 0);
  return <Modal title={`Record payment · ${customer.name}`} onClose={onClose}>
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-[var(--ink-2)]">Amount<Input className="mt-1" name="amount" type="number" min="0.01" step="0.01" autoFocus required placeholder="0.00" /></label>
        <label className="text-sm font-semibold text-[var(--ink-2)]">Received on<Input className="mt-1" name="receivedAt" type="date" defaultValue={isoToday()} required /></label>
        <label className="text-sm font-semibold text-[var(--ink-2)]">Mode<select name="paymentMode" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="upi">UPI</option><option value="cash">Cash</option><option value="neft">NEFT</option><option value="rtgs">RTGS</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select></label>
        <label className="text-sm font-semibold text-[var(--ink-2)]">Account<select name="moneyAccount" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="bank">Bank</option><option value="cash_drawer">Cash drawer</option><option value="undeposited">Undeposited funds</option></select></label>
      </div>
      {orders.length ? <label className="block text-sm font-semibold text-[var(--ink-2)]">Sales order <span className="font-normal text-[var(--ink-4)]">(optional)</span><select name="salesOrderId" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Customer advance, no order selected</option>{orders.map((order: any) => <option key={order.id} value={order.id}>{order.orderNumber} · {money(order.totalAmount)} · {String(order.paymentStatus || 'pending').replaceAll('_', ' ')}</option>)}</select></label> : null}
      {invoices.length ? <label className="block text-sm font-semibold text-[var(--ink-2)]">Invoice <span className="font-normal text-[var(--ink-4)]">(optional, overrides order)</span><select name="salesInvoiceId" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="">Allocate within the selected order</option>{invoices.map((invoice: any) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · open {money(invoice.openAmount)}</option>)}</select></label> : null}
      <label className="block text-sm font-semibold text-[var(--ink-2)]">Reference / UTR<Input className="mt-1" name="reference" placeholder="UPI reference, cheque number or bank UTR" /></label>
      <label className="block text-sm font-semibold text-[var(--ink-2)]">Note<textarea name="notes" className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" placeholder="Optional payment note" /></label>
      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-2)]"><input type="checkbox" name="autoAllocate" defaultChecked />Allocate to open invoice(s) in the selected scope</label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}Post receipt</Button></div>
    </form>
  </Modal>;
}

function InvoiceReview({ draft, busy, onClose, onChange, onSubmit }: any) { return <Modal title={`Invoice dispatched goods · ${draft.orderNumber}`} onClose={onClose} wide><div className="space-y-4"><p className="text-sm leading-6 text-[var(--ink-3)]">{draft.customer?.name || 'Customer'} · Select only the dispatched lines to bill. Each selected dispatch line can be invoiced once.</p><div className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="divide-y divide-[var(--line)]">{draft.lines.map((line: any, index: number) => <label key={line.id} className="flex cursor-pointer items-center gap-3 p-4 hover:bg-[var(--bg-soft)]"><input type="checkbox" checked={line.selected} onChange={(event) => onChange({ ...draft, lines: draft.lines.map((candidate: any, candidateIndex: number) => candidateIndex === index ? { ...candidate, selected: event.target.checked } : candidate) })} /><div className="min-w-0 flex-1"><p className="truncate font-bold text-[var(--ink)]">{line.name}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{line.sku} · challan {line.challanId || '-'}</p></div><span className="font-bold tabular-nums text-[var(--ink)]">{line.quantity} PC</span></label>)}</div></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[var(--ink-2)]">Due date<Input className="mt-1" type="date" value={draft.dueDate} onChange={(event) => onChange({ ...draft, dueDate: event.target.value })} /></label><label className="text-sm font-semibold text-[var(--ink-2)]">Invoice note<textarea className="mt-1 min-h-20 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}Post invoice</Button></div></div></Modal>; }

function AllocationForm({ payment, account, busy, onClose, onSubmit }: any) { const openInvoices = (account?.invoices || []).filter((invoice: any) => Number(invoice.openAmount) > 0); return <Modal title={`Allocate ${payment.receiptNumber}`} onClose={onClose}><form action={onSubmit} className="space-y-4"><p className="text-sm leading-6 text-[var(--ink-3)]">Available customer credit: <strong className="text-[var(--ink)]">{money(payment.unappliedAmount)}</strong></p><label className="block text-sm font-semibold text-[var(--ink-2)]">Invoice<select name="salesInvoiceId" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm" required><option value="">Choose invoice</option>{openInvoices.map((invoice: any) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · open {money(invoice.openAmount)}</option>)}</select></label><label className="block text-sm font-semibold text-[var(--ink-2)]">Amount<Input className="mt-1" name="amount" type="number" min="0.01" max={payment.unappliedAmount} step="0.01" defaultValue={payment.unappliedAmount} required /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>Allocate credit</Button></div></form></Modal>; }

function CreditProfileForm({ account, busy, onCancel, onSubmit }: any) { const profile = account.profile || {}; return <section className="rounded-lg border border-[var(--brand-200)] bg-[var(--bg-soft)] p-4"><form action={onSubmit} className="space-y-3"><div className="flex items-center justify-between"><div><p className="font-bold text-[var(--ink)]">Credit control</p><p className="mt-1 text-xs text-[var(--ink-4)]">Owner or sales manager setting. Existing posted documents are not changed.</p></div><button type="button" onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--surface)]" title="Close"><X className="h-4 w-4" /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-[var(--ink-2)]">Credit limit<Input className="mt-1" name="creditLimit" type="number" min="0" defaultValue={profile.creditLimit || 0} /></label><label className="text-sm font-semibold text-[var(--ink-2)]">Default terms<Input className="mt-1" name="terms" defaultValue={profile.defaultPaymentTerms || ''} placeholder="Net 30" /></label></div><label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-2)]"><input name="creditHold" type="checkbox" defaultChecked={!!profile.creditHold} />Place new credit sales on hold</label><label className="block text-sm font-semibold text-[var(--ink-2)]">Hold reason<Input className="mt-1" name="holdReason" defaultValue={profile.holdReason || ''} placeholder="Reason shown to managers" /></label><div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save control</Button></div></form></section>; }

function FollowUpForm({ item, busy, onClose, onSubmit }: any) { return <Modal title="Schedule collection follow-up" onClose={onClose}><form action={onSubmit} className="space-y-4"><p className="text-sm text-[var(--ink-3)]">{item.customer?.name || 'Customer'} {item.invoiceNumber ? `· ${item.invoiceNumber}` : ''}</p><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[var(--ink-2)]">Due date<Input className="mt-1" name="dueAt" type="date" defaultValue={isoToday()} /></label><label className="text-sm font-semibold text-[var(--ink-2)]">Priority<select name="priority" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></label></div><label className="block text-sm font-semibold text-[var(--ink-2)]">Follow-up note<textarea name="note" className="mt-1 min-h-24 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm" required placeholder="Call outcome required, commitment date, or escalation." /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}Create follow-up</Button></div></form></Modal>; }
