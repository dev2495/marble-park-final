'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Palette, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DATA = gql`query { masterProductFinishes }`;
const SAVE = gql`mutation($input: ProductFinishInput!) { saveProductFinish(input: $input) { data } }`;
const empty = { id:'', name:'', code:'', description:'', status:'active', sortOrder:0 };
export default function FinishMasterPage(){
 const {data, refetch}=useQuery(DATA); const [form,setForm]=useState<any>(empty); const [save,{loading}]=useMutation(SAVE,{onCompleted:()=>{refetch();setForm(empty);}}); const rows=data?.masterProductFinishes||[];
 return <div className="space-y-7 pb-10"><section className="rounded-r6 bg-[#18181b] p-7 text-white"><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Finish master</p><h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Control colour and finish values used across SKU creation and import review.</h1></section><section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]"><div className="mp-card rounded-r5 p-5"><Palette className="h-7 w-7 text-[#2563eb]" /><div className="mt-5 grid gap-3">{['name','code','description','status','sortOrder'].map(k=><label key={k} className="space-y-2"><span className="text-xs font-medium uppercase tracking-widest text-[#52525b]">{k}</span><Input type={k==='sortOrder'?'number':'text'} value={form[k]||''} onChange={e=>setForm({...form,[k]:k==='sortOrder'?Number(e.target.value):e.target.value})}/></label>)}<Button disabled={loading||!form.name} onClick={()=>save({variables:{input:form}})}><Save className="mr-2 h-4 w-4"/>Save finish</Button></div></div><div className="mp-card rounded-r5 p-5"><h2 className="text-2xl font-semibold text-[#18181b]">Finishes</h2><div className="mt-5 space-y-2">{rows.map((r:any)=><button key={r.id} onClick={()=>setForm(r)} className="w-full rounded-2xl bg-white/75 p-4 text-left"><p className="font-semibold text-[#18181b]">{r.name}</p><p className="text-xs font-bold text-[#52525b]">{r.status} · {r.code}</p></button>)}</div></div></section></div>;
}
