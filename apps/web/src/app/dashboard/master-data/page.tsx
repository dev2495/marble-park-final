import Link from 'next/link';
import { BadgeCheck, Building2, Database, FileImage, Layers3, PackagePlus, Palette, Settings, Users } from 'lucide-react';
const modules = [
  ['Product Master','Create/edit SKUs and item selling data.','/dashboard/master-data/products',PackagePlus],
  ['Import Center','Upload PDF/Excel, stage rows, submit approvals.','/dashboard/master-data/imports',Database],
  ['Catalogue Image Review','Map extracted images to products and submit approvals.','/dashboard/master-data/catalogue-review',FileImage],
  ['Category Master','Control inventory/catalogue category list.','/dashboard/master-data/categories',Layers3],
  ['Brand Master','Control dropdown brands for SKU and import review.','/dashboard/master-data/brands',BadgeCheck],
  ['Finish Master','Control colour/finish dropdowns for all SKUs.','/dashboard/master-data/finishes',Palette],
  ['Vendor Master','Manage supplier records for inwards.','/dashboard/master-data/vendors',Building2],
  ['Customer Master','Manage customers, sites, designers and architects.','/dashboard/customers',Users],
  ['System Settings','Company, quote, challan and approval settings.','/dashboard/settings',Settings],
];
export default function MasterDataIndex(){return <div className="space-y-7 pb-10"><section className="rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white"><p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#bfdbfe]">Master data modules</p><h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Separate control rooms for each master function.</h1><p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#dbeafe]">Catalogue browsing, SKU creation, imports, vendors, customers and settings are split so role permissions stay clean.</p></section><section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{modules.map(([title,body,href,Icon]: any)=><Link href={href} key={href} className="mp-card rounded-[2rem] p-6 transition hover:-translate-y-1 hover:shadow-2xl"><Icon className="h-8 w-8 text-[#2563eb]"/><h2 className="mt-5 text-2xl font-black text-[#0e1a3d]">{title}</h2><p className="mt-2 text-sm font-bold leading-6 text-[#475569]">{body}</p></Link>)}</section></div>}
