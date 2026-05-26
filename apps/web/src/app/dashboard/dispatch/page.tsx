'use client';

import Link from 'next/link';
import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CheckCircle, Clock, FileText, MapPin, Package, PackageSearch, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const GET_DISPATCH_QUEUE = gql`
  query GetDispatchQueue {
    dispatchQueue
  }
`;
const CREATE_CHALLAN = gql`mutation CreateChallan($input: CreateChallanInput!) { createChallan(input: $input) { id status challanNumber } }`;
const UPDATE_CHALLAN = gql`mutation UpdateChallan($id: ID!, $status: String!, $proof: JSON) { updateChallanStatus(id: $id, status: $status, proof: $proof) { id status } }`;

const columns = [
  { id: 'pending', title: 'Pending allocation', icon: Clock },
  { id: 'packed', title: 'Packed', icon: Package },
  { id: 'dispatched', title: 'In transit', icon: Truck },
  { id: 'delivered', title: 'Delivered', icon: CheckCircle },
];

function jobLines(job: any) {
  return Array.isArray(job.lines) ? job.lines : [];
}

export default function DispatchPage() {
  const [dispatchQty, setDispatchQty] = useState<Record<string, number>>({});
  const [deliveryProof, setDeliveryProof] = useState<Record<string, { receiverName: string; receiverContact: string; photoUrl: string; signatureUrl: string; notes: string }>>({});
  const { data, loading, error, refetch } = useQuery(GET_DISPATCH_QUEUE, { pollInterval: 30000 });
  const [createChallan, { loading: creating, error: createError }] = useMutation(CREATE_CHALLAN, { onCompleted: () => refetch() });
  const [updateChallan, { loading: updating, error: updateError }] = useMutation(UPDATE_CHALLAN, { onCompleted: () => refetch() });
  const jobs = data?.dispatchQueue || [];
  const readyCount = jobs.reduce((sum: number, job: any) => sum + (job.readyLines?.length || 0), 0);
  const pendingCount = jobs.reduce((sum: number, job: any) => sum + (job.pendingInwardLines?.length || 0), 0);
  const invalidCount = jobs.reduce((sum: number, job: any) => sum + (job.invalidLines?.length || 0), 0);

  const updateProof = (challanId: string, patch: Partial<{ receiverName: string; receiverContact: string; photoUrl: string; signatureUrl: string; notes: string }>) => {
    setDeliveryProof((current) => {
      const existing = current[challanId] || { receiverName: '', receiverContact: '', photoUrl: '', signatureUrl: '', notes: '' };
      return { ...current, [challanId]: { ...existing, ...patch } };
    });
  };

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createError ? <QueryErrorBanner error={createError} /> : null}
      {updateError ? <QueryErrorBanner error={updateError} /> : null}

      <section className="relative overflow-hidden rounded-r6 border border-[var(--line)] bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-6 shadow-sm-soft">
        <div className="absolute right-8 top-6 h-28 w-28 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">Dispatch control</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em] text-[var(--ink)]">Dispatch only what is reserved.</h1>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-[var(--ink-3)]">
              The board separates ready rows from confirmed-but-not-inward rows. Pending-inward items stay blocked until GRN receives stock and auto-reserves it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="secondary" size="lg">
              <Link href="/dashboard/pending-inward"><PackageSearch className="mr-2 h-5 w-5" /> Pending inward</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/dashboard/inventory/inwards"><Package className="mr-2 h-5 w-5" /> GRN inward</Link>
            </Button>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
            <p className="text-2xl font-black text-[var(--ink)]">{jobs.length}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Open jobs</p>
          </div>
          <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
            <p className="text-2xl font-black text-emerald-700">{readyCount}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Ready rows</p>
          </div>
          <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
            <p className="text-2xl font-black text-amber-700">{pendingCount}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Pending inward</p>
          </div>
          <div className="rounded-r4 border border-[var(--line)] bg-white/80 p-4 shadow-sm-soft">
            <p className="text-2xl font-black text-red-700">{invalidCount}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Needs rebuild</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        {columns.map((column, index) => {
          const rows = jobs.filter((job: any) => job.status === column.id || (column.id === 'pending' && !job.status));
          return (
            <div key={column.id} className="min-h-[560px] rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
              <div className="flex items-center justify-between px-1 pb-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-r4 bg-[var(--brand-50)] text-[var(--brand-700)]"><column.icon className="h-5 w-5" /></div>
                  <h2 className="font-semibold text-[var(--ink)]">{column.title}</h2>
                </div>
                <span className="rounded-full bg-[var(--bg-soft)] px-2.5 py-1 text-xs font-black text-[var(--brand-700)]">{rows.length}</span>
              </div>

              <div className="space-y-3">
                {loading ? <p className="rounded-r4 bg-[var(--bg-soft)] p-4 text-sm font-bold text-[var(--ink-3)]">Loading...</p> : rows.map((job: any) => (
                  <motion.article key={job.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="rounded-r4 border border-[var(--line)] bg-white/85 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-sm-soft">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-widest text-[var(--ink-4)]">{job.salesOrder?.orderNumber || job.quote?.quoteNumber || job.id}</p>
                        <h3 className="mt-1 truncate text-base font-black text-[var(--ink)]">{job.customer?.name || 'Dispatch job'}</h3>
                      </div>
                      <FileText className="h-5 w-5 shrink-0 text-[var(--brand-700)]" />
                    </div>
                    <p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-[var(--ink-3)]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{job.siteAddress || 'Site address pending'}</p>

                    <div className="mt-4 space-y-2">
                      {jobLines(job).filter((line: any) => Number(line.remainingQty || 0) > 0).map((line: any, lineIndex: number) => {
                        const key = `${job.id}:${line.productId || line.sku || line.name || lineIndex}`;
                        const max = Number(line.dispatchableQty || 0);
                        const desired = Math.max(1, Math.min(Number(dispatchQty[key] || max || 1), max || 1));
                        const ready = line.status === 'ready' && max > 0;
                        const invalid = line.status === 'invalid_product';
                        return (
                          <div key={key} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black text-[var(--ink)]">{line.name || line.sku}</p>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">
                                  Ordered {line.orderedQty} · Ready {line.dispatchableQty} · Pending {line.blockedQty}
                                </p>
                              </div>
                              <span className={ready ? 'rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase text-emerald-700' : invalid ? 'rounded-full bg-red-50 px-2 py-1 text-[10px] font-black uppercase text-red-700' : 'rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-700'}>
                                {ready ? 'Ready' : invalid ? 'Rebuild quote' : 'Pending inward'}
                              </span>
                            </div>
                            {ready ? (
                              <div className="mt-3 flex gap-2">
                                <input
                                  type="number"
                                  min={1}
                                  max={max}
                                  value={desired}
                                  onChange={(event) => setDispatchQty({ ...dispatchQty, [key]: Number(event.target.value) || 1 })}
                                  className="h-9 w-20 rounded-md border border-[var(--line)] bg-white px-2 text-center text-sm font-black text-[var(--ink)]"
                                />
                                <Button
                                  size="sm"
                                  disabled={creating}
                                  onClick={() => createChallan({
                                    variables: {
                                      input: {
                                        jobId: job.id,
                                        transporter: 'Store vehicle',
                                        vehicleNo: 'PENDING',
                                        driverName: 'Dispatch desk',
                                        driverPhone: job.customer?.mobile || '0000000000',
                                        lines: JSON.stringify([{ ...line, dispatchQty: desired }]),
                                      },
                                    },
                                  })}
                                >
                                  Partial challan
                                </Button>
                              </div>
                            ) : invalid ? (
                              <p className="mt-3 text-xs font-semibold text-red-700">This is an old/manual quote row without a Product Master SKU. Rebuild the quote from Product Master before dispatch.</p>
                            ) : (
                              <p className="mt-3 text-xs font-semibold text-[var(--ink-3)]">Blocked until this SKU is received on GRN and auto-reserved.</p>
                            )}
                          </div>
                        );
                      })}
                      {job.challans?.map((challan: any) => {
                        const proof = deliveryProof[challan.id] || { receiverName: '', receiverContact: '', photoUrl: '', signatureUrl: '', notes: '' };
                        const proofReady = proof.receiverName.trim() && (proof.photoUrl.trim() || proof.signatureUrl.trim());
                        return (
                          <div key={challan.id} className="rounded-r4 bg-[var(--bg-soft)] p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">{challan.challanNumber} · {challan.status}</span>
                              {challan.status === 'pending' && <Button size="sm" disabled={updating} onClick={() => updateChallan({ variables: { id: challan.id, status: 'dispatched' } })}>Dispatch</Button>}
                            </div>
                            {challan.status === 'dispatched' ? (
                              <div className="mt-3 grid gap-2">
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <input
                                    value={proof.receiverName}
                                    onChange={(event) => updateProof(challan.id, { receiverName: event.target.value })}
                                    placeholder="Receiver name"
                                    className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
                                  />
                                  <input
                                    value={proof.receiverContact}
                                    onChange={(event) => updateProof(challan.id, { receiverContact: event.target.value })}
                                    placeholder={`Contact ${job.customer?.mobile || ''}`.trim()}
                                    className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
                                  />
                                  <input
                                    value={proof.photoUrl}
                                    onChange={(event) => updateProof(challan.id, { photoUrl: event.target.value })}
                                    placeholder="Proof photo URL"
                                    className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
                                  />
                                  <input
                                    value={proof.signatureUrl}
                                    onChange={(event) => updateProof(challan.id, { signatureUrl: event.target.value })}
                                    placeholder="Signature URL"
                                    className="h-9 rounded-md border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
                                  />
                                </div>
                                <textarea
                                  value={proof.notes}
                                  onChange={(event) => updateProof(challan.id, { notes: event.target.value })}
                                  placeholder="Delivery note"
                                  className="min-h-[60px] rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--brand-400)]"
                                />
                                <Button
                                  size="sm"
                                  disabled={updating || !proofReady}
                                  onClick={() => updateChallan({
                                    variables: {
                                      id: challan.id,
                                      status: 'delivered',
                                      proof: {
                                        receiverName: proof.receiverName.trim(),
                                        receiverContact: proof.receiverContact.trim() || job.customer?.mobile || '',
                                        photoUrl: proof.photoUrl.trim() || undefined,
                                        signatureUrl: proof.signatureUrl.trim() || undefined,
                                        notes: proof.notes.trim() || undefined,
                                      },
                                    },
                                  })}
                                >
                                  Deliver with proof
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </motion.article>
                ))}
                {!loading && rows.length === 0 && <div className="grid h-40 place-items-center rounded-r4 border border-dashed border-[var(--line)] text-center text-sm font-bold text-[var(--ink-4)]">No jobs</div>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
