'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, FileText, MapPin, Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  const { data, loading } = useQuery(GET_DISPATCH_DATA);
  const [createChallan, { loading: creating }] = useMutation(CREATE_CHALLAN, { refetchQueries: [{ query: GET_DISPATCH_DATA }] });
  const [updateChallan, { loading: updating }] = useMutation(UPDATE_CHALLAN, { refetchQueries: [{ query: GET_DISPATCH_DATA }] });
  const jobs = data?.dispatchJobs || [];
  const challans = data?.dispatchChallans || [];

  const dispatchedQty = (job: any, line: any) => challans
    .filter((challan: any) => challan.dispatchJobId === job.id && ['pending', 'dispatched', 'delivered'].includes(challan.status))
    .flatMap((challan: any) => Array.isArray(challan.lines) ? challan.lines : [])
    .filter((row: any) => row.productId === line.productId)
    .reduce((sum: number, row: any) => sum + Number(row.dispatchQty || row.qty || row.quantity || 0), 0);

  return (
    <div className="space-y-7 pb-10">
      <section className="rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">Dispatch control</p>
            <h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Pack, challan, dispatch, close.</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#d9c4a9]">A reservation-aware board for daily loads, pending challans and site delivery state.</p>
          </div>
          <Button size="lg" className="bg-[#fffaf3] text-[#211b16] hover:bg-white"><Truck className="mr-2 h-5 w-5" /> Manual dispatch</Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        {columns.map((column, index) => {
          const rows = jobs.filter((job: any) => job.status === column.id || (column.id === 'pending' && !job.status));
          return (
            <div key={column.id} className="min-h-[560px] rounded-[2rem] border border-[#7a5b3c]/12 bg-[#fffaf3]/70 p-4 shadow-xl shadow-[#6b4f38]/8 backdrop-blur">
              <div className="flex items-center justify-between px-1 pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#ead7c0] text-[#7a4f2e]"><column.icon className="h-5 w-5" /></div>
                  <h2 className="font-black text-[#211b16]">{column.title}</h2>
                </div>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black text-[#7a4f2e]">{rows.length}</span>
              </div>
              <div className="space-y-3">
                {loading ? <p className="rounded-2xl bg-white/60 p-4 text-sm font-bold text-[#7d6b5c]">Loading...</p> : rows.map((job: any) => (
                  <motion.article key={job.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="rounded-[1.5rem] bg-white/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-[#8b6b4c]">{job.id}</p>
                        <h3 className="mt-1 text-base font-black text-[#211b16]">{job.customer?.name || 'Dispatch job'}</h3>
                      </div>
                      <FileText className="h-5 w-5 text-[#b57942]" />
                    </div>
                    <p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-[#7d6b5c]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{job.siteAddress || 'Site address pending'}</p>
                    <div className="mt-4 rounded-2xl bg-[#ead7c0]/70 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#7a4f2e]">Quote {job.quote?.quoteNumber || job.quoteId || 'manual'}</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {((Array.isArray(job.quote?.lines) ? job.quote.lines : []) as any[]).map((line: any) => {
                        const totalQty = Number(line.qty || line.quantity || 0);
                        const remaining = Math.max(0, totalQty - dispatchedQty(job, line));
                        const key = `${job.id}:${line.productId}`;
                        if (remaining <= 0) return null;
                        return <div key={key} className="w-full rounded-2xl bg-[#fffaf3] p-3">
                          <p className="text-xs font-black text-[#211b16]">{line.name || line.sku}</p>
                          <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Remaining {remaining} of {totalQty}</p>
                          <div className="mt-2 flex gap-2">
                            <input type="number" min={1} max={remaining} value={dispatchQty[key] || remaining} onChange={(event) => setDispatchQty({ ...dispatchQty, [key]: Number(event.target.value) || 1 })} className="h-9 w-20 rounded-xl border border-[#7a5b3c]/15 bg-white px-2 text-center text-sm font-black" />
                            <Button size="sm" disabled={creating} onClick={() => createChallan({ variables: { input: { jobId: job.id, transporter: 'Store vehicle', vehicleNo: 'PENDING', driverName: 'Dispatch desk', driverPhone: job.customer?.mobile || '0000000000', lines: JSON.stringify([{ ...line, dispatchQty: Math.min(Number(dispatchQty[key] || remaining), remaining) }]) } } })}>Partial challan</Button>
                          </div>
                        </div>;
                      })}
                      {challans.filter((challan: any) => challan.dispatchJobId === job.id).map((challan: any) => (
                        <div key={challan.id} className="flex flex-wrap gap-2">
                          <span className="rounded-2xl bg-[#211b16] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white">{challan.challanNumber} · {challan.status}</span>
                          {challan.status === 'pending' && <Button size="sm" disabled={updating} onClick={() => updateChallan({ variables: { id: challan.id, status: 'dispatched' } })}>Dispatch</Button>}
                          {challan.status === 'dispatched' && <Button size="sm" disabled={updating} onClick={() => updateChallan({ variables: { id: challan.id, status: 'delivered' } })}>Deliver</Button>}
                        </div>
                      ))}
                    </div>
                  </motion.article>
                ))}
                {!loading && rows.length === 0 && <div className="grid h-40 place-items-center rounded-[1.5rem] border border-dashed border-[#7a5b3c]/20 text-center text-sm font-bold text-[#8b6b4c]">No jobs</div>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
