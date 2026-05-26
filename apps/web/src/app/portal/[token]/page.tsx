'use client';

import { useParams } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { ShieldCheck } from 'lucide-react';

const PORTAL_QUERY = gql`
  query PortalSnapshot($token: String!) {
    portalSnapshot(token: $token)
  }
`;

export default function PortalPage() {
  const params = useParams<{ token: string }>();
  const { data, loading, error } = useQuery(PORTAL_QUERY, { variables: { token: params?.token || '' }, fetchPolicy: 'network-only' });

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading your portal…</div>;
  }
  if (error) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
          <h1 className="text-xl font-bold text-rose-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-rose-800">This portal link is invalid, expired, or has been revoked. Please ask Marble Park for a new one.</p>
        </div>
      </div>
    );
  }

  const snap = data?.portalSnapshot;
  if (!snap) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-[#2563eb] text-sm font-bold text-white">MP</div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Marble Park · Customer Portal</p>
              <h1 className="text-lg font-bold text-slate-900">{snap.customer.name}</h1>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Read-only · expires {new Date(snap.meta.expiresAt).toLocaleDateString()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 lg:px-8 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Your contact</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <p><span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Phone</span><br />{snap.customer.mobile || '—'}</p>
            <p><span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Email</span><br />{snap.customer.email || '—'}</p>
            <p><span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Site</span><br />{snap.customer.siteAddress || '—'}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Your quotes</h2>
          {snap.quotes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No quotes shared with you yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {snap.quotes.map((q: any) => (
                <li key={q.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{q.quoteNumber}</p>
                    <p className="text-xs text-slate-500">{q.title}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">{q.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Your orders</h2>
          {snap.salesOrders.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No orders yet.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {snap.salesOrders.map((o: any) => (
                <div key={o.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-bold text-slate-900">{o.orderNumber}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(o.createdAt).toLocaleDateString()}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold capitalize text-blue-800">{o.status}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold capitalize text-emerald-800">{o.paymentStatus}</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-900">₹{Number(o.totalAmount).toLocaleString('en-IN')}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Payment history</h2>
          {snap.payments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No payments recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {snap.payments.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-semibold capitalize text-slate-900">{p.mode}</p>
                    <p className="text-xs text-slate-500">{new Date(p.paidAt).toLocaleDateString()}{p.reference ? ` · ${p.reference}` : ''}</p>
                  </div>
                  <span className={p.direction === 'refund' ? 'text-sm font-bold text-rose-700' : 'text-sm font-bold text-emerald-700'}>
                    {p.direction === 'refund' ? '−' : '+'}₹{Number(p.amount).toLocaleString('en-IN')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Dispatch & delivery</h2>
          {snap.dispatches.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No dispatches yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {snap.dispatches.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{d.challanNumber}</p>
                    <p className="text-xs text-slate-500">
                      {d.deliveredAt ? `Delivered ${new Date(d.deliveredAt).toLocaleDateString()}` : d.dispatchedAt ? `In transit since ${new Date(d.dispatchedAt).toLocaleDateString()}` : 'Being packed'}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">{d.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-xs text-slate-500">
          For changes or questions, please contact Marble Park directly. This page is read-only.
        </p>
      </main>
    </div>
  );
}
