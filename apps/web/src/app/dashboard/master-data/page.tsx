'use client';

import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { BadgeCheck, Building2, Database, FileImage, Layers3, PackagePlus, Palette, Settings, Users } from 'lucide-react';

const MASTER_COUNTS = gql`
  query MasterDataCounts {
    products(take: 10000) { id }
    masterProductCategories
    masterProductBrands
    masterProductFinishes
    vendors
  }
`;

const modules = [
  ['Product Master', 'Create/edit SKUs, images, prices and catalogue-ready item data.', '/dashboard/master-data/products', PackagePlus, 'products'],
  ['Import Center', 'Upload PDF/Excel, stage rows, review missing masters, submit approvals.', '/dashboard/master-data/imports', Database, 'imports'],
  ['Catalogue Image Review', 'Map extracted images to SKUs and submit for owner approval.', '/dashboard/master-data/catalogue-review', FileImage, 'images'],
  ['Category Master', 'Control inventory/catalogue category dropdowns.', '/dashboard/master-data/categories', Layers3, 'masterProductCategories'],
  ['Brand Master', 'Control product brands and quote logo strip.', '/dashboard/master-data/brands', BadgeCheck, 'masterProductBrands'],
  ['Finish Master', 'Control colour/finish dropdowns for all SKUs.', '/dashboard/master-data/finishes', Palette, 'masterProductFinishes'],
  ['Vendor Master', 'Manage supplier records for inwards and catalogues.', '/dashboard/master-data/vendors', Building2, 'vendors'],
  ['Customer Master', 'Manage customers, sites, designers and architects.', '/dashboard/customers', Users, 'customers'],
  ['System Settings', 'Company, quote, challan and approval settings.', '/dashboard/settings', Settings, 'settings'],
];

export default function MasterDataIndex() {
  const { data } = useQuery(MASTER_COUNTS, { fetchPolicy: 'cache-and-network' });
  const countFor = (key: string) => Array.isArray(data?.[key]) ? data[key].length : null;

  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-r6 border border-[var(--line)] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-7 text-white shadow-sm-soft lg:p-8">
        <div className="absolute right-10 top-8 h-32 w-32 rounded-full bg-blue-500/20 blur-3xl" />
        <p className="relative text-xs font-bold uppercase tracking-[0.18em] text-blue-200/80">Master data control</p>
        <h1 className="relative mt-3 max-w-5xl font-display text-4xl font-bold leading-[0.98] tracking-[-0.04em] text-white lg:text-6xl">One clean control room for products, brands, categories, finishes and suppliers.</h1>
        <p className="relative mt-4 max-w-3xl text-sm font-semibold leading-6 text-blue-100/80 lg:text-base">These masters feed SKU creation, imports, catalogue filters, quote sections, inventory inward and dispatch workflows. Open a module to create, edit and verify live production rows.</p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {modules.map(([title, body, href, Icon, key]: any) => {
          const count = countFor(key);
          return (
            <Link href={href} key={href} className="group mp-panel min-h-[12rem] p-5 transition hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)]"><Icon className="h-6 w-6" /></div>
                {count !== null ? <span className="rounded-full bg-[var(--bg-soft)] px-3 py-1 text-xs font-bold text-[var(--ink-3)]">{count} live</span> : null}
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--ink)]">{title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-[var(--ink-4)]">{body}</p>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--brand-700)] opacity-80 transition group-hover:opacity-100">Open module</p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
