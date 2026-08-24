import Link from 'next/link';
import { BadgeCheck, BadgeIndianRupee, Building2, Compass, Database, Grid3X3, Layers3, PackagePlus, Palette, Settings, Users } from 'lucide-react';

const modules = [
  ['Product Master','Create and edit SKUs, prices, media galleries, quote-ready descriptions and inventory defaults.','/dashboard/master-data/products',PackagePlus],
  ['MRP Readiness Desk','Owner/admin queue to complete legacy missing MRP, optional NRP and floor with read-only lot-cost coverage.','/dashboard/master-data/pricing-readiness',BadgeIndianRupee],
  ['Excel Import Center','Download live master dropdowns, preview every row and bulk-create protected new SKUs with image URLs or embedded worksheet images.','/dashboard/master-data/imports',Database],
  ['Category Master','Control product categories used by Product Master, catalogue filters, quote intent and reports.','/dashboard/master-data/categories',Layers3],
  ['Tiles Master','Search and govern tile design SKUs, showroom display codes, aliases and physical display placement.','/dashboard/master-data/tiles',Grid3X3],
  ['Tile Size Master','Maintain the controlled size dropdown used only by tile SKUs.','/dashboard/master-data/tile-sizes',Grid3X3],
  ['Brand Master','Control dropdown brands and optional quote-logo metadata.','/dashboard/master-data/brands',BadgeCheck],
  ['Finish Master','Control colour/finish dropdowns for all SKUs and imports.','/dashboard/master-data/finishes',Palette],
  ['Vendor Master','Manage suppliers used by procurement, PO and GRN flows.','/dashboard/master-data/vendors',Building2],
  ['Architect Master','Manage consulting architects selected on quotes for PDFs, filters and reports.','/dashboard/master-data/architects',Compass],
  ['Customer Master','Manage customers, sites, designers and legacy architect notes.','/dashboard/customers',Users],
  ['System Settings','Company profile, document prefixes, contact details and client-reset controls.','/dashboard/settings',Settings],
];

export default function MasterDataIndex() {
  return (
    <div className="space-y-7 pb-10">
      <section className="mp-card rounded-r6 border border-[var(--line)] p-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">Master data modules</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-0.04em] text-[var(--ink)]">Every reusable list has one clean control room.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">Product creation, Excel imports, vendors, customers, tile rules and settings are separated so role permissions stay clean and sales users only see quote-ready data.</p>
      </section>
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {modules.map(([title, body, href, Icon]: any) => (
          <Link href={href} key={href} className="mp-card group rounded-r5 border border-[var(--line)] p-6 transition hover:-translate-y-1 hover:border-[var(--brand-300)] hover:shadow-md-soft">
            <div className="grid h-11 w-11 place-items-center rounded-r3 bg-[var(--brand-50)] text-[var(--brand-700)] transition group-hover:scale-105"><Icon className="h-5 w-5" /></div>
            <h2 className="mt-5 text-2xl font-semibold text-[var(--ink)]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-4)]">{body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
