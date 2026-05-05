import Link from 'next/link';
import { ArrowRight, Bath, Boxes, FileSpreadsheet, ShieldCheck, type LucideIcon } from 'lucide-react';

const features: Array<[string, string, LucideIcon]> = [
  ['Catalogue', 'Vendor Excel/PDF imports with product images and source trace.', Bath],
  ['Inventory', 'Inward, reserved, available, damaged, and dispatch-ready stock.', Boxes],
  ['Quotes', 'Beautiful product-led proposals for retail and project clients.', FileSpreadsheet],
  ['Roles', 'Owner, sales, inventory, and dispatch workspaces with auth.', ShieldCheck],
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f3eadf] text-[#211b16]">
      <section className="relative min-h-screen px-6 py-6 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(181,123,70,0.28),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(37,82,75,0.20),transparent_28%),linear-gradient(135deg,#fffaf3,#ead7c0_55%,#d6b48e)]" />
        <div className="absolute inset-x-8 bottom-0 h-52 rounded-t-[4rem] bg-[#211b16]/10 blur-3xl" />

        <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col rounded-[2.5rem] border border-white/55 bg-white/55 p-5 shadow-2xl shadow-[#6b4f38]/20 backdrop-blur-2xl lg:p-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#211b16] text-xl font-black text-[#f3eadf] shadow-xl">MP</div>
              <div>
                <div className="text-lg font-black leading-none tracking-tight">Marble Park</div>
                <div className="mt-1 text-[10px] font-black uppercase tracking-[0.26em] text-[#7d6b5c]">Retail OS</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" className="rounded-2xl border border-[#211b16]/10 bg-white/70 px-5 py-3 text-sm font-black text-[#211b16] shadow-sm transition hover:bg-white">Login</Link>
              <Link href="/dashboard" className="hidden rounded-2xl bg-[#211b16] px-5 py-3 text-sm font-black text-white shadow-xl transition hover:translate-y-[-1px] sm:inline-flex">Open App</Link>
            </div>
          </header>

          <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.86fr] lg:py-6">
            <div className="max-w-3xl">
              <h1 className="text-6xl font-black leading-[0.88] tracking-[-0.06em] text-[#211b16] sm:text-7xl lg:text-8xl">
                Retail inventory that sells the product before the quote is sent.
              </h1>
              <p className="mt-7 max-w-2xl text-lg font-semibold leading-8 text-[#6d5c4e]">
                A full CRM, catalogue, inward, quote, dispatch, and owner dashboard system for sanitaryware, faucets, sinks, tiles, and project retail operations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-[#b57942] px-7 text-sm font-black uppercase tracking-wider text-white shadow-2xl shadow-[#b57942]/30 transition hover:-translate-y-0.5">
                  Start login <ArrowRight size={18} />
                </Link>
                <Link href="/dashboard/products" className="inline-flex h-14 items-center justify-center rounded-2xl border border-[#211b16]/10 bg-white/70 px-7 text-sm font-black uppercase tracking-wider text-[#211b16] shadow-sm transition hover:bg-white">
                  View catalogue
                </Link>
              </div>
            </div>

            <div className="relative min-h-[520px] overflow-hidden rounded-[2.25rem] bg-[#211b16] p-5 text-white shadow-2xl shadow-[#211b16]/25">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.20),transparent_24%),linear-gradient(140deg,rgba(181,123,70,0.55),transparent_42%)]" />
              <div className="relative grid h-full grid-rows-[1fr_auto] gap-5">
                <div className="grid grid-cols-2 gap-4">
                  {features.map(([title, body, Icon], index) => (
                    <div key={String(title)} className={`rounded-[1.75rem] border border-white/10 bg-white/[0.08] p-5 backdrop-blur ${index === 0 ? 'col-span-2' : ''}`}>
                      <Icon className="mb-5 h-9 w-9 text-[#e8c39b]" strokeWidth={1.4} />
                      <div className="text-2xl font-black tracking-tight">{title}</div>
                      <p className="mt-2 text-sm font-semibold leading-6 text-white/58">{body}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-[1.75rem] bg-[#f3eadf] p-5 text-[#211b16]">
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Demo credentials</div>
                  <div className="mt-2 grid gap-2 text-sm font-black sm:grid-cols-2">
                    <div>owner@marblepark.com</div>
                    <div>password123</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
