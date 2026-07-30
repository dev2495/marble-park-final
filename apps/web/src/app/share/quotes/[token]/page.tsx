import { Download, ExternalLink, Printer } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SharedQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const documentUrl = `/api/share/quote/${encodeURIComponent(token)}`;
  return <main className="min-h-screen bg-[#f4f4f5] text-[#18181b]">
    <header className="border-b border-[#e4e4e7] bg-white px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><img src="/brand/marble-park-logo.png" alt="Marble Park" className="h-11 w-11 object-contain" /><div><p className="font-semibold">Marble Park</p><p className="text-xs text-[#71717a]">Customer quotation</p></div></div>
        <nav className="flex items-center gap-2">
          <a href={`${documentUrl}?download=1`} className="inline-flex h-10 items-center rounded-md bg-[#9f2520] px-4 text-sm font-semibold text-white"><Download className="mr-2 h-4 w-4" />Download</a>
          <a href={documentUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md border border-[#d4d4d8] bg-white px-4 text-sm font-semibold"><Printer className="mr-2 h-4 w-4" />Print</a>
        </nav>
      </div>
    </header>
    <section className="mx-auto h-[calc(100vh-4.5rem)] max-w-[100rem] p-2 sm:p-4">
      <iframe title="Marble Park quotation" src={documentUrl} className="h-full w-full rounded-md border border-[#d4d4d8] bg-white shadow-sm" />
      <a href={documentUrl} target="_blank" rel="noreferrer" className="fixed bottom-5 right-5 inline-flex h-11 items-center rounded-md border border-[#d4d4d8] bg-white px-4 text-sm font-semibold shadow-lg sm:hidden"><ExternalLink className="mr-2 h-4 w-4" />Open PDF</a>
    </section>
  </main>;
}
