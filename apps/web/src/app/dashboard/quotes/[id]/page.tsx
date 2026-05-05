'use client';

import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useState } from 'react';
import { ArrowLeft, CheckCircle, Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImageFrame } from '@/components/product-image-frame';

const QUOTE_DETAIL = gql`
  query QuoteDetail($id: ID!) {
    quote(id: $id) {
      id
      quoteNumber
      title
      projectName
      status
      approvalStatus
      discountPercent
      createdAt
      validUntil
      sentAt
      confirmedAt
      notes
      lines
      customer
      owner
      lead
    }
  }
`;

const SEND_QUOTE = gql`mutation SendQuote($id: ID!) { sendQuote(id: $id) { id status sentAt } }`;
const CONFIRM_QUOTE = gql`mutation ConfirmQuote($id: ID!) { confirmQuote(id: $id) { id status confirmedAt } }`;
const CREATE_SALES_ORDER = gql`mutation CreateSalesOrderFromQuote($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function productImage(media: any) {
  if (!media) return '/catalogue-art/faucet.svg';
  if (typeof media === 'string') {
    try { return JSON.parse(media)?.primary || '/catalogue-art/faucet.svg'; } catch { return media || '/catalogue-art/faucet.svg'; }
  }
  return media.primary || media.gallery?.[0] || '/catalogue-art/faucet.svg';
}

export default function QuoteDetailPage({ params }: { params: { id: string } }) {
  const [paymentMode, setPaymentMode] = useState('cash');
  const [advanceAmount, setAdvanceAmount] = useState('0');
  const [orderMessage, setOrderMessage] = useState('');
  const { data, loading, refetch } = useQuery(QUOTE_DETAIL, { variables: { id: params.id } });
  const [sendQuote, { loading: sending }] = useMutation(SEND_QUOTE, { onCompleted: () => refetch() });
  const [confirmQuote, { loading: confirming }] = useMutation(CONFIRM_QUOTE, { onCompleted: () => refetch() });
  const [createSalesOrder, { loading: creatingOrder }] = useMutation(CREATE_SALES_ORDER, { onCompleted: (result) => { setOrderMessage(`Sales order ${result.createSalesOrderFromQuote.orderNumber} created.`); refetch(); }, onError: (error) => setOrderMessage(error.message) });
  const quote = data?.quote;
  const lines = Array.isArray(quote?.lines) ? quote.lines : [];
  const subtotal = lines.reduce((sum: number, line: any) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0);
  const tax = subtotal * 0.18;
  const total = subtotal + tax;

  if (loading) return <div className="mp-card rounded-[2rem] p-10 text-center font-bold text-[#8b6b4c]">Loading quote...</div>;
  if (!quote) return <div className="mp-card rounded-[2rem] p-10 text-center font-bold text-[#8b6b4c]">Quote not found.</div>;

  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(181,123,66,0.45),transparent_28%),radial-gradient(circle_at_86%_35%,rgba(36,84,77,0.45),transparent_30%)]" />
        <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <Link href="/dashboard/quotes" className="inline-flex items-center gap-2 text-sm font-black text-[#e8c39b]"><ArrowLeft className="h-4 w-4" /> Back to quote register</Link>
            <p className="mt-6 text-[10px] font-black uppercase tracking-[0.28em] text-[#e8c39b]">{quote.status} quotation</p>
            <h1 className="mt-2 max-w-4xl text-5xl font-black tracking-[-0.055em]">{quote.quoteNumber}</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#d9c4a9]">{quote.title || quote.projectName || 'Retail quotation'} for {quote.customer?.name || 'Customer'}.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-[#fffaf3] text-[#211b16] hover:bg-white"><a href={`/api/pdf/quote/${quote.id}`} target="_blank" rel="noreferrer"><Download className="mr-2 h-5 w-5" /> Download PDF</a></Button>
            {quote.status !== 'sent' && quote.status !== 'confirmed' && <Button disabled={sending} onClick={() => sendQuote({ variables: { id: quote.id } })} variant="warning" size="lg"><Send className="mr-2 h-5 w-5" /> Mark sent</Button>}
            {quote.status !== 'confirmed' && <Button disabled={confirming} onClick={() => confirmQuote({ variables: { id: quote.id } })} size="lg"><CheckCircle className="mr-2 h-5 w-5" /> Confirm & dispatch</Button>}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.42fr]">
        <div className="overflow-hidden rounded-[2rem] border border-[#7a5b3c]/10 bg-[#fffaf3]/85 shadow-xl shadow-[#6b4f38]/8">
          <div className="border-b border-[#7a5b3c]/10 bg-[#ead7c0]/75 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-[#6e563f]">Quote lines</div>
          <div className="divide-y divide-[#7a5b3c]/10">
            {lines.map((line: any, index: number) => {
              const qty = Number(line.qty || line.quantity || 0);
              const price = Number(line.price || line.sellPrice || 0);
              return (
                <article key={`${line.sku}-${index}`} className="grid gap-4 p-5 lg:grid-cols-[7rem_1fr_8rem_8rem_8rem] lg:items-center">
                  <ProductImageFrame src={productImage(line.media)} alt={line.name} className="h-28 w-32 rounded-[1.35rem]" imageClassName="p-2" />
                  <div><p className="text-lg font-black text-[#211b16]">{line.name}</p><p className="mt-1 text-xs font-black uppercase tracking-wider text-[#8b6b4c]">{line.sku} · {line.brand || ''}</p></div>
                  <div className="font-black text-[#211b16]">{qty} {line.unit || 'PC'}</div>
                  <div className="font-black text-[#211b16]">{money(price)}</div>
                  <div className="text-right text-xl font-black text-[#24544d]">{money(qty * price)}</div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="space-y-5">
          <div className="mp-card rounded-[2rem] p-6">
            <h2 className="text-2xl font-black tracking-tight">Customer</h2>
            <p className="mt-4 text-lg font-black text-[#211b16]">{quote.customer?.name || 'Customer'}</p>
            <p className="mt-2 text-sm font-bold text-[#7d6b5c]">{quote.customer?.mobile || quote.customer?.phone}</p>
            <p className="mt-2 text-sm font-bold text-[#7d6b5c]">{quote.customer?.siteAddress || quote.customer?.city}</p>
          </div>
          <div className="mp-card rounded-[2rem] p-6">
            <h2 className="text-2xl font-black tracking-tight">Totals</h2>
            <div className="mt-5 space-y-3 text-sm font-bold text-[#5f4b3b]"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>GST 18%</span><span>{money(tax)}</span></div><div className="flex justify-between border-t border-[#7a5b3c]/10 pt-4 text-2xl font-black text-[#211b16]"><span>Total</span><span>{money(total)}</span></div></div>
          </div>
          <div className="mp-card rounded-[2rem] p-6">
            <h2 className="text-2xl font-black tracking-tight">Convert to sales order</h2>
            <p className="mt-2 text-sm font-bold text-[#8b6b4c]">Use after final customer confirmation. Cash orders capture advance/full payment; credit orders are tagged for owner reports.</p>
            <label className="mt-4 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Payment</span><select value={paymentMode} onChange={(e)=>setPaymentMode(e.target.value)} className="h-11 w-full rounded-2xl border border-[#7a5b3c]/15 bg-white px-4 text-sm font-black"><option value="cash">Cash</option><option value="credit">Credit</option></select></label>
            {paymentMode === 'cash' && <label className="mt-3 block space-y-2"><span className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">Advance / full paid</span><input type="number" value={advanceAmount} onChange={(e)=>setAdvanceAmount(e.target.value)} className="h-11 w-full rounded-2xl border border-[#7a5b3c]/15 bg-white px-4 text-sm font-black" /></label>}
            {orderMessage && <p className="mt-3 rounded-2xl bg-[#ead7c0]/70 p-3 text-xs font-black uppercase tracking-wider text-[#7a4f2e]">{orderMessage}</p>}
            <Button className="mt-4 w-full" disabled={creatingOrder || quote.approvalStatus === 'pending'} onClick={()=>createSalesOrder({variables:{input:{quoteId:quote.id,paymentMode,advanceAmount:Number(advanceAmount||0),notes:'Created from quote detail'}}})}>Create sales order</Button>
            {quote.approvalStatus === 'pending' && <p className="mt-2 text-xs font-bold text-red-700">Owner approval required before conversion.</p>}
          </div>
        </aside>
      </section>
    </div>
  );
}
