'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { FileImage, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TASKS = gql`query { catalogReviewTasks(take: 80) }`;
const SEARCH_PRODUCTS = gql`query($query: String!) { globalSearch(query: $query) { products } }`;
const SUBMIT = gql`mutation($id: String!, $productId: String!) { submitCatalogReviewTaskForApproval(id: $id, productId: $productId) { data } }`;

export default function CatalogueReviewPage() {
  const [query, setQuery] = useState('');
  const [taskId, setTaskId] = useState('');
  const { data, refetch } = useQuery(TASKS);
  const { data: searchData } = useQuery(SEARCH_PRODUCTS, { variables: { query }, skip: query.length < 2 });
  const [submit] = useMutation(SUBMIT, { onCompleted: () => refetch() });
  const tasks = data?.catalogReviewTasks || [];
  return <div className="space-y-7 pb-10">
    <section className="rounded-r6 mp-card bg-white border border-[#e4e4e7] p-6 text-[#18181b]"><p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a]">Catalogue image review</p><h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-[#18181b]">Map extracted PDF images to SKUs, then submit for owner approval.</h1></section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tasks.map((task:any)=><article key={task.id} className="mp-card rounded-r5 p-4"><div className="rounded-r4 bg-white p-2">{task.imageUrl ? <img src={task.imageUrl} alt="catalogue extracted" className="h-56 w-full object-contain" /> : <div className="grid h-56 place-items-center"><FileImage /></div>}</div><p className="mt-3 font-semibold text-[#18181b]">{task.status}</p><p className="text-xs font-bold text-[#52525b]">{task.detectedSku || task.id}</p><Button className="mt-3 w-full" variant={taskId===task.id?'default':'outline'} onClick={()=>setTaskId(task.id)}>Map this image</Button></article>)}</section>
    {taskId && <section className="fixed bottom-5 left-1/2 z-50 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 rounded-r5 border border-[#e4e4e7]/15 bg-white p-4 shadow-2xl"><div className="flex items-center gap-3"><Search className="h-5 w-5 text-[#52525b]" /><Input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search SKU/name to map selected image" /></div><div className="mt-3 max-h-64 overflow-y-auto custom-scrollbar">{searchData?.globalSearch?.products?.map((product:any)=><button key={product.id} onClick={()=>submit({variables:{id:taskId, productId:product.id}})} className="flex w-full justify-between rounded-2xl p-3 text-left hover:bg-[#eff6ff]/70"><span className="font-semibold text-[#18181b]">{product.sku} · {product.name}</span><span className="text-xs font-black text-[#52525b]">Submit approval</span></button>)}</div></section>}
  </div>;
}
