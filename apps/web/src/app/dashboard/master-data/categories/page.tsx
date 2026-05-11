'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Layers3, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DATA = gql`query { masterProductCategories }`;
const SAVE_CATEGORY = gql`mutation($input: ProductCategoryInput!) { saveProductCategory(input: $input) { data } }`;
const empty = { id:'', name:'', code:'', description:'', status:'active', sortOrder:0 };
export default function CategoryMasterPage(){
 const {data, refetch}=useQuery(DATA); const [form,setForm]=useState<any>(empty); const [save,{loading}]=useMutation(SAVE_CATEGORY,{onCompleted:()=>{refetch();setForm(empty);}}); const rows=data?.masterProductCategories||[];
 return <div className="space-y-7 pb-10"><section className="rounded-[2.25rem] bg-[#241b14] p-7 text-white"><p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#ead7bd]">Category master</p><h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Control catalogue and inventory categories.</h1></section><section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]"><div className="mp-card rounded-[2rem] p-5"><Layers3 className="h-7 w-7 text-[#b17643]" /><div className="mt-5 grid gap-3">{['name','code','description','status','sortOrder'].map(k=><label key={k} className="space-y-2"><span className="text-[10px] font-black uppercase tracking-widest text-[#6f6258]">{k}</span><Input type={k==='sortOrder'?'number':'text'} value={form[k]||''} onChange={e=>setForm({...form,[k]:k==='sortOrder'?Number(e.target.value):e.target.value})}/></label>)}<Button disabled={loading||!form.name} onClick={()=>save({variables:{input:form}})}><Save className="mr-2 h-4 w-4"/>Save category</Button></div></div><div className="mp-card rounded-[2rem] p-5"><h2 className="text-2xl font-black text-[#241b14]">Categories</h2><div className="mt-5 space-y-2">{rows.map((r:any)=><button key={r.id} onClick={()=>setForm(r)} className="w-full rounded-2xl bg-white/75 p-4 text-left"><p className="font-black text-[#241b14]">{r.name}</p><p className="text-xs font-bold text-[#6f6258]">{r.status} · {r.code}</p></button>)}</div></div></section></div>;
}
