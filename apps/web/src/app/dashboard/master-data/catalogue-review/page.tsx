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
    <section className="rounded-[2.25rem] bg-[#241b14] p-7 text-white shadow-2xl shadow-[#241b14]/15"><p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#ead7bd]">Catalogue image review</p><h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Map extracted PDF images to SKUs, then submit for owner approval.</h1></section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tasks.map((task:any)=><article key={task.id} className="mp-card rounded-[2rem] p-4"><div className="rounded-[1.5rem] bg-white p-2">{task.imageUrl ? <img src={task.imageUrl} alt="catalogue extracted" className="h-56 w-full object-contain" /> : <div className="grid h-56 place-items-center"><FileImage /></div>}</div><p className="mt-3 font-black text-[#241b14]">{task.status}</p><p className="text-xs font-bold text-[#6f6258]">{task.detectedSku || task.id}</p><Button className="mt-3 w-full" variant={taskId===task.id?'default':'outline'} onClick={()=>setTaskId(task.id)}>Map this image</Button></article>)}</section>
    {taskId && <section className="fixed bottom-5 left-1/2 z-50 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[2rem] border border-[#d9cbbd]/15 bg-[#ffffff] p-4 shadow-2xl"><div className="flex items-center gap-3"><Search className="h-5 w-5 text-[#6f6258]" /><Input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search SKU/name to map selected image" /></div><div className="mt-3 max-h-64 overflow-y-auto custom-scrollbar">{searchData?.globalSearch?.products?.map((product:any)=><button key={product.id} onClick={()=>submit({variables:{id:taskId, productId:product.id}})} className="flex w-full justify-between rounded-2xl p-3 text-left hover:bg-[#f6eadb]/70"><span className="font-black text-[#241b14]">{product.sku} · {product.name}</span><span className="text-xs font-black text-[#6f6258]">Submit approval</span></button>)}</div></section>}
  </div>;
}
