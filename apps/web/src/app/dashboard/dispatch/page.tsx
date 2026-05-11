'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, FileText, MapPin, Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const GET_DISPATCH_DATA = gql`
  query GetDispatchData {
    dispatchJobs { id quoteId siteAddress status dueDate customer quote }
    dispatchChallans { id challanNumber status dispatchJobId customer quote lines }
  }
`;
const CREATE_CHALLAN = gql`mutation CreateChallan($input: CreateChallanInput!) { createChallan(input: $input) { id status challanNumber } }`;
const UPDATE_CHALLAN = gql`mutation UpdateChallan($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`;

const columns = [
  { id: 'pending', title: 'Pending allocation', icon: Clock },
  { id: 'packed', title: 'Packed', icon: Package },
  { id: 'dispatched', title: 'In transit', icon: Truck },
  { id: 'delivered', title: 'Delivered', icon: CheckCircle },
];

export default function DispatchPage() {
  const [dispatchQty, setDispatchQty] = useState<Record<string, number>>({});
  const { data, loading, error, refetch } = useQuery(GET_DISPATCH_DATA);
  const [createChallan, { loading: creating, error: createError }] = useMutation(CREATE_CHALLAN, { refetchQueries: [{ query: GET_DISPATCH_DATA }] });
  const [updateChallan, { loading: updating, error: updateError }] = useMutation(UPDATE_CHALLAN, { refetchQueries: [{ query: GET_DISPATCH_DATA }] });
  const jobs = data?.dispatchJobs || [];
  const challans = data?.dispatchChallans || [];

  const dispatchedQty = (job: any, line: any) => challans
    .filter((challan: any) => challan.dispatchJobId === job.id && ['pending', 'dispatched', 'delivered'].includes(challan.status))
    .flatMap((challan: any) => Array.isArray(challan.lines) ? challan.lines : [])
    .filter((row: any) => row.productId === line.productId)
    .reduce((sum: number, row: any) => sum + Number(row.dispatchQty || row.qty || row.quantity || 0), 0);

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {updateError ? <QueryErrorBanner error={updateError} /> : null}
      <section className="rounded-r6 mp-card bg-white border border-[#e4e4e7] p-6 text-[#18181b]">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Dispatch control</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Pack, challan, dispatch, close.</h1>
            <p className="mt-3 max-w-2xl text-sm text-[#52525b]">A reservation-aware board for daily loads, pending challans and site delivery state.</p>
          </div>
          <Button size="lg" className="bg-[#2563eb] text-white hover:bg-[#1d4ed8]"><Truck className="mr-2 h-5 w-5" /> Manual dispatch</Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        {columns.map((column, index) => {
          const rows = jobs.filter((job: any) => job.status === column.id || (column.id === 'pending' && !job.status));
          return (
            <div key={column.id} className="min-h-[560px] rounded-r5 border border-[#e4e4e7]/12 bg-white/70 p-4 shadow-xl shadow-[#475569]/8 backdrop-blur">
              <div className="flex items-center justify-between px-1 pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#eff6ff] text-[#1d4ed8]"><column.icon className="h-5 w-5" /></div>
                  <h2 className="font-semibold text-[#18181b]">{column.title}</h2>
                </div>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black text-[#1d4ed8]">{rows.length}</span>
              </div>
              <div className="space-y-3">
                {loading ? <p className="rounded-2xl bg-white/60 p-4 text-sm font-bold text-[#52525b]">Loading...</p> : rows.map((job: any) => (
                  <motion.article key={job.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="rounded-r4 bg-white/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-widest text-[#52525b]">{job.id}</p>
                        <h3 className="mt-1 text-base font-semibold text-[#18181b]">{job.customer?.name || 'Dispatch job'}</h3>
                      </div>
                      <FileText className="h-5 w-5 text-[#2563eb]" />
                    </div>
                    <p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-[#52525b]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{job.siteAddress || 'Site address pending'}</p>
                    <div className="mt-4 rounded-2xl bg-[#eff6ff]/70 px-3 py-2 text-xs font-medium uppercase tracking-wider text-[#1d4ed8]">Quote {job.quote?.quoteNumber || job.quoteId || 'manual'}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {((Array.isArray(job.quote?.lines) ? job.quote.lines : []) as any[]).map((line: any) => {
                        const totalQty = Number(line.qty || line.quantity || 0);
                        const remaining = Math.max(0, totalQty - dispatchedQty(job, line));
                        const key = `${job.id}:${line.productId}`;
                        if (remaining <= 0) return null;
                        return <div key={key} className="w-full rounded-2xl bg-white p-3">
                          <p className="text-xs font-semibold text-[#18181b]">{line.name || line.sku}</p>
                          <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[#52525b]">Remaining {remaining} of {totalQty}</p>
                          <div className="mt-2 flex gap-2">
                            <input type="number" min={1} max={remaining} value={dispatchQty[key] || remaining} onChange={(event) => setDispatchQty({ ...dispatchQty, [key]: Number(event.target.value) || 1 })} className="h-9 w-20 rounded-xl border border-[#e4e4e7]/15 bg-white px-2 text-center text-sm font-black" />
                            <Button size="sm" disabled={creating} onClick={() => createChallan({ variables: { input: { jobId: job.id, transporter: 'Store vehicle', vehicleNo: 'PENDING', driverName: 'Dispatch desk', driverPhone: job.customer?.mobile || '0000000000', lines: JSON.stringify([{ ...line, dispatchQty: Math.min(Number(dispatchQty[key] || remaining), remaining) }]) } } })}>Partial challan</Button>
                          </div>
                        </div>;
                      })}
                      {challans.filter((challan: any) => challan.dispatchJobId === job.id).map((challan: any) => (
                        <div key={challan.id} className="flex flex-wrap gap-2">
                          <span className="rounded-2xl bg-[#18181b] px-3 py-2 text-xs font-medium uppercase tracking-wider text-white">{challan.challanNumber} · {challan.status}</span>
                          {challan.status === 'pending' && <Button size="sm" disabled={updating} onClick={() => updateChallan({ variables: { id: challan.id, status: 'dispatched' } })}>Dispatch</Button>}
                          {challan.status === 'dispatched' && <Button size="sm" disabled={updating} onClick={() => updateChallan({ variables: { id: challan.id, status: 'delivered' } })}>Deliver</Button>}
                        </div>
                      ))}
                    </div>
                  </motion.article>
                ))}
                {!loading && rows.length === 0 && <div className="grid h-40 place-items-center rounded-r4 border border-dashed border-[#e4e4e7]/20 text-center text-sm font-bold text-[#52525b]">No jobs</div>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
