'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { FileSpreadsheet, ListChecks, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const INTENTS = gql`query IntentDesk($status: String) { leadIntents(status: $status) }`;
const GENERATE = gql`mutation GenerateQuoteFromIntent($intentId: String!, $note: String, $displayMode: String) { generateQuoteFromIntent(intentId: $intentId, note: $note, displayMode: $displayMode) }`;

function money(value: number) { return `₹${Math.round(value || 0).toLocaleString('en-IN')}`; }
function rowsTotal(rows: any[]) { return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + Number(row.qty || row.quantity || 0) * Number(row.price || row.sellPrice || 0), 0); }

export default function IntentDeskPage() {
  const [displayModeByIntent, setDisplayModeByIntent] = useState<Record<string, string>>({});
  const { data, loading, error, refetch } = useQuery(INTENTS, { variables: { status: 'pending_quote' } });
  const [generate, { loading: generating, error: generateError }] = useMutation(GENERATE, { onCompleted: () => refetch() });
  const intents = data?.leadIntents || [];

  return <div className="space-y-6 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {generateError ? <QueryErrorBanner error={generateError} /> : null}
    <section className="rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#e8c39b]">Office intent desk</p>
      <h1 className="mt-3 text-5xl font-black tracking-[-0.055em]">Convert sales intent into quote-ready proposals.</h1>
      <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-[#d9c4a9]">Sales captures area-wise category/product/tile requirements. Office chooses whether the PDF is a price-hidden selection summary or a priced quotation.</p>
    </section>

    <section className="mp-card flex flex-wrap items-center justify-between gap-3 rounded-[2rem] p-5">
      <div><h2 className="text-2xl font-black text-[#211b16]">Pending intents</h2><p className="mt-1 text-sm font-bold text-[#8b6b4c]">{loading ? 'Loading...' : `${intents.length} intent(s) need quote generation.`}</p></div>
      <Button variant="outline" onClick={() => refetch()}><RefreshCcw className="mr-2 h-4 w-4"/>Refresh</Button>
    </section>

    <section className="grid gap-4">
      {intents.map((intent: any) => {
        const displayMode = displayModeByIntent[intent.id] || 'priced';
        return <article key={intent.id} className="mp-card rounded-[2rem] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#8b6b4c]">{intent.intentType} · {intent.status}</p>
              <Link href={`/dashboard/leads/${intent.leadId}`} className="mt-1 block text-2xl font-black text-[#211b16] hover:underline">{intent.lead?.title || 'Lead intent'}</Link>
              <p className="mt-1 text-sm font-bold text-[#7d6b5c]">{intent.customer?.name || 'Customer'} · Sales: {intent.owner?.name || 'Unassigned'}</p>
              {intent.notes && <p className="mt-3 max-w-3xl rounded-2xl bg-white/70 p-3 text-sm font-bold text-[#6e563f]">{intent.notes}</p>}
            </div>
            <div className="text-right"><p className="text-2xl font-black text-[#211b16]">{money(rowsTotal(intent.rows))}</p><p className="text-xs font-black uppercase tracking-wider text-[#b57942]">{intent.rows?.length || 0} rows</p></div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(intent.rows || []).map((row: any, index: number) => <div key={index} className="rounded-2xl bg-white/75 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-[#b57942]">{row.area || 'General Selection'}</p>
              <p className="mt-1 font-black text-[#211b16]">{row.name || row.tileCode || row.sku || row.category || 'Item'}</p>
              <p className="mt-1 text-xs font-bold text-[#8b6b4c]">{row.category || row.type || 'Catalogue'} · Qty {row.qty || row.quantity || 0} {row.uom || row.unit || 'PC'}</p>
              {(row.category === 'Tiles' || row.type === 'tile') && <p className="mt-2 rounded-xl bg-[#ead7c0] px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#7a4f2e]">Tile {row.tileSize || row.size || 'size?'} · {row.pcsPerBox || 0} pcs/box</p>}
            </div>)}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            <select value={displayMode} onChange={(event)=>setDisplayModeByIntent({...displayModeByIntent,[intent.id]:event.target.value})} className="h-11 rounded-2xl border border-[#7a5b3c]/15 bg-white px-4 text-sm font-black text-[#211b16]">
              <option value="priced">Selection with quote prices</option>
              <option value="selection">Selection summary only - hide prices</option>
            </select>
            <Button disabled={generating} onClick={() => generate({ variables: { intentId: intent.id, note: 'Generated from office intent desk', displayMode } })}><FileSpreadsheet className="mr-2 h-4 w-4"/>Generate quote for sales</Button>
          </div>
        </article>;
      })}
      {!loading && !intents.length && <div className="mp-card grid min-h-64 place-items-center rounded-[2rem] p-8 text-center"><div><ListChecks className="mx-auto h-10 w-10 text-[#b57942]"/><h2 className="mt-4 text-2xl font-black text-[#211b16]">No pending intents</h2><p className="mt-2 text-sm font-bold text-[#8b6b4c]">New lead and follow-up intents will appear here.</p></div></div>}
    </section>
  </div>;
}
