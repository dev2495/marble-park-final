'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { BadgeCheck, ImagePlus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DATA = gql`query { masterProductBrands }`;
const SAVE = gql`mutation($input: ProductBrandInput!) { saveProductBrand(input: $input) { data } }`;
const empty = { id:'', name:'', code:'', description:'', status:'active', sortOrder:0, logoUrl:'' };

export default function BrandMasterPage(){
 const {data, refetch}=useQuery(DATA);
 const [form,setForm]=useState<any>(empty);
 const [save,{loading}]=useMutation(SAVE,{onCompleted:()=>{refetch();setForm(empty);}});
 const rows=data?.masterProductBrands||[];
 const submit=()=>save({variables:{input:{id:form.id||undefined,name:form.name,code:form.code,description:form.description,status:form.status,sortOrder:Number(form.sortOrder||0),metadata:{...(form.metadata||{}),logoUrl:form.logoUrl||''}}}});
 const selectRow=(row:any)=>setForm({...row,logoUrl:row.metadata?.logoUrl||''});
 return <div className="space-y-7 pb-10">
  <section className="rounded-r6 bg-[#18181b] p-7 text-white"><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Brand master</p><h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Control product brands and quote logo strip.</h1><p className="mt-4 max-w-2xl text-sm text-[#52525b]">Add a logo URL for every brand you want displayed inside quotation PDFs.</p></section>
  <section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
   <div className="mp-card rounded-r5 p-5"><BadgeCheck className="h-7 w-7 text-[#2563eb]" /><div className="mt-5 grid gap-3">
    {['name','code','description','status','sortOrder'].map(k=><label key={k} className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">{k}</span><Input type={k==='sortOrder'?'number':'text'} value={form[k]||''} onChange={e=>setForm({...form,[k]:k==='sortOrder'?Number(e.target.value):e.target.value})}/></label>)}
    <label className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">Brand logo URL</span><div className="flex gap-2"><Input value={form.logoUrl||''} onChange={e=>setForm({...form,logoUrl:e.target.value})} placeholder="/brand-logos/grohe.png or https://..."/><div className="grid h-10 w-12 place-items-center rounded-xl bg-[#eff6ff] text-[#1d4ed8]"><ImagePlus className="h-4 w-4"/></div></div></label>
    {form.logoUrl && <div className="grid h-20 place-items-center rounded-2xl bg-white/75 p-3"><img src={form.logoUrl} alt="brand logo preview" className="max-h-14 max-w-full object-contain"/></div>}
    <Button disabled={loading||!form.name} onClick={submit}><Save className="mr-2 h-4 w-4"/>Save brand</Button>
   </div></div>
   <div className="mp-card rounded-r5 p-5"><h2 className="text-2xl font-semibold text-[#18181b]">Brands</h2><div className="mt-5 grid gap-2 md:grid-cols-2">{rows.map((r:any)=><button key={r.id} onClick={()=>selectRow(r)} className="flex items-center gap-3 rounded-2xl bg-white/75 p-4 text-left"><div className="grid h-12 w-16 place-items-center rounded-xl bg-[#eff6ff]/65">{r.metadata?.logoUrl?<img src={r.metadata.logoUrl} alt={r.name} className="max-h-9 max-w-14 object-contain"/>:<span className="text-xs font-black text-[#1d4ed8]">{String(r.name||'MP').slice(0,2).toUpperCase()}</span>}</div><div><p className="font-semibold text-[#18181b]">{r.name}</p><p className="text-xs font-bold text-[#52525b]">{r.status} · {r.code}</p></div></button>)}</div></div>
  </section>
 </div>;
}
