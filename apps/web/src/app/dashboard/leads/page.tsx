'use client';

import { gql, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { CalendarClock, Mail, Phone, PlusCircle } from 'lucide-react';
import Link from 'next/link';

const GET_LEADS = gql`
  query Leads {
    leads {
      id
      title
      source
      stage
      expectedValue
      notes
      nextActionAt
      customer
      owner
    }
  }
`;

const stages = [
  { title: 'New', id: 'new' },
  { title: 'Contacted', id: 'contacted' },
  { title: 'Quoted', id: 'quoted' },
  { title: 'Negotiation', id: 'negotiation' },
  { title: 'Won', id: 'won' },
];

function currency(value?: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export default function LeadsPipelinePage() {
  const { data, loading } = useQuery(GET_LEADS);
  const leads = data?.leads || [];

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col gap-6 overflow-hidden pb-4">
      <section className="flex flex-col justify-between gap-4 rounded-[2rem] bg-[#211b16] p-6 text-white shadow-2xl shadow-[#211b16]/15 lg:flex-row lg:items-end">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">CRM pipeline</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.045em]">Lead movement without sales confusion.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#d9c4a9]">Track walk-ins, architects, BOQs, follow-ups and quote-stage handoffs in one board.</p>
        </div>
        <Link href="/dashboard/leads/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#fffaf3] px-5 text-sm font-black text-[#211b16] shadow-xl">
          <PlusCircle className="h-5 w-5" /> Add lead
        </Link>
      </section>

      <div className="flex-1 overflow-x-auto pb-4 custom-scrollbar">
        <div className="flex h-full min-w-max gap-4">
          {stages.map((stage) => {
            const rows = leads.filter((lead: any) => lead.stage === stage.id || (stage.id === 'quoted' && lead.stage === 'proposal'));
            return (
              <section key={stage.id} className="flex h-full w-80 flex-col overflow-hidden rounded-[2rem] border border-[#7a5b3c]/12 bg-[#fffaf3]/72 shadow-lg shadow-[#6b4f38]/8 backdrop-blur">
                <div className="border-b border-[#7a5b3c]/10 bg-[#ead7c0]/75 p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-black text-[#211b16]">{stage.title}</h2>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-black text-[#7a4f2e]">{rows.length}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3 custom-scrollbar">
                  {loading ? <p className="p-4 text-sm font-bold text-[#7d6b5c]">Loading...</p> : rows.map((lead: any, index: number) => (
                    <motion.article key={lead.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="rounded-[1.5rem] bg-white/80 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#211b16] text-sm font-black text-[#fffaf3]">{lead.customer?.name?.[0] || 'L'}</div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black uppercase tracking-wider text-[#8b6b4c]">{lead.customer?.name || lead.source}</p>
                          <p className="truncate text-[11px] font-bold text-[#7d6b5c]">{lead.owner?.name || 'Unassigned'}</p>
                        </div>
                      </div>
                      <Link href={`/dashboard/leads/${lead.id}`} className="line-clamp-2 text-base font-black leading-tight text-[#211b16] hover:underline">{lead.title}</Link>
                      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-[#7d6b5c]">{lead.notes}</p>
                      <div className="mt-4 flex items-center justify-between border-t border-[#7a5b3c]/10 pt-3">
                        <span className="text-sm font-black text-[#24544d]">{currency(lead.expectedValue)}</span>
                        <div className="flex gap-2 text-[#8b6b4c]"><Phone className="h-4 w-4" /><Mail className="h-4 w-4" /><CalendarClock className="h-4 w-4" /></div>
                      </div>
                    </motion.article>
                  ))}
                  {!loading && rows.length === 0 && <div className="rounded-[1.5rem] border border-dashed border-[#7a5b3c]/20 p-8 text-center text-sm font-bold text-[#8b6b4c]">No leads here</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
