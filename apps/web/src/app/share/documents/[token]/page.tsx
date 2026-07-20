'use client';

import { use, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, ShieldCheck } from 'lucide-react';

const API_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || '').origin; } catch { return ''; }
})();
const vaultEndpoint = (path: string) => `${API_ORIGIN}${path}`;

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [asset, setAsset] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(vaultEndpoint(`/api/document-vault/public/${encodeURIComponent(token)}/meta`), { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'This link is invalid, expired or has been revoked.');
        setAsset(payload);
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'This shared file is unavailable.');
      });
    return () => controller.abort();
  }, [token]);

  if (!asset && !error) return <main className="flex min-h-screen items-center justify-center bg-[#111113] text-white"><Loader2 className="h-7 w-7 animate-spin text-[#d66a62]" /><span className="ml-3 text-sm font-semibold">Opening shared file…</span></main>;

  if (error) return <main className="flex min-h-screen items-center justify-center bg-[#111113] p-6 text-white"><section className="max-w-md text-center"><img src="/brand/marble-park-logo.jpg" alt="Marble Park" className="mx-auto h-16 w-16 rounded-lg object-contain" /><h1 className="mt-6 font-display text-3xl font-bold">This presentation is no longer available.</h1><p className="mt-3 text-sm leading-6 text-zinc-400">{error}</p><p className="mt-6 text-xs font-semibold uppercase text-zinc-500">Ask the sender for a new Marble Park link</p></section></main>;

  const content = vaultEndpoint(asset.contentUrl);
  return (
    <main className="min-h-screen bg-[#111113] text-white">
      <header className="flex min-h-20 items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3"><img src="/brand/marble-park-logo.jpg" alt="Marble Park" className="h-11 w-11 shrink-0 rounded-md bg-white object-contain" /><div className="min-w-0"><p className="truncate text-sm font-bold">Marble Park</p><p className="truncate text-xs text-zinc-400">Premium Bath Solutions</p></div></div>
        {asset.allowDownload ? <a href={vaultEndpoint(asset.downloadUrl)} className="inline-flex h-9 shrink-0 items-center rounded-md bg-white px-3 text-sm font-semibold text-black hover:bg-zinc-200"><Download className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Download</span></a> : <span className="flex items-center gap-2 text-xs font-semibold text-zinc-400"><ShieldCheck className="h-4 w-4" /> Presentation link</span>}
      </header>

      <section className="grid min-h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-[55vh] min-w-0 items-center justify-center overflow-hidden bg-black">
          {asset.mediaKind === 'image' ? <img src={content} alt={asset.title} className="max-h-[calc(100vh-5rem)] w-full object-contain" /> : null}
          {asset.mediaKind === 'pdf' ? <iframe src={content} title={asset.title} className="h-[calc(100vh-5rem)] min-h-[42rem] w-full bg-white" /> : null}
          {asset.mediaKind === 'video' ? <video src={content} controls autoPlay={false} preload="metadata" className="max-h-[calc(100vh-5rem)] w-full bg-black" /> : null}
          {asset.mediaKind === 'audio' ? <div className="w-full max-w-2xl px-6"><div className="mb-8 flex justify-center"><FileText className="h-20 w-20 text-[#d66a62]" /></div><audio src={content} controls preload="metadata" className="w-full" /></div> : null}
          {asset.mediaKind === 'document' ? <div className="max-w-md px-6 text-center"><FileSpreadsheet className="mx-auto h-20 w-20 text-[#d66a62]" /><h2 className="mt-5 text-xl font-bold">This file opens in its native app.</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Download the original {asset.originalName} to view or edit it.</p>{asset.allowDownload ? <a href={vaultEndpoint(asset.downloadUrl)} className="mt-6 inline-flex h-10 items-center rounded-md bg-white px-5 text-sm font-semibold text-black"><Download className="mr-2 h-4 w-4" /> Download file</a> : null}</div> : null}
        </div>
        <aside className="border-t border-white/10 bg-[#18181b] p-6 lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase text-[#e4837c]">{asset.category}</p>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight">{asset.title}</h1>
          {asset.description ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{asset.description}</p> : null}
          <dl className="mt-7 divide-y divide-white/10 border-y border-white/10 text-xs"><div className="flex justify-between gap-4 py-3"><dt className="text-zinc-500">Original file</dt><dd className="min-w-0 truncate font-semibold text-zinc-200">{asset.originalName}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-zinc-500">Size</dt><dd className="font-semibold text-zinc-200">{formatBytes(asset.sizeBytes)}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-zinc-500">Access</dt><dd className="font-semibold text-zinc-200">{asset.allowDownload ? 'Download button shown' : 'Download button hidden'}</dd></div>{asset.expiresAt ? <div className="flex justify-between gap-4 py-3"><dt className="text-zinc-500">Available until</dt><dd className="font-semibold text-zinc-200">{new Date(asset.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</dd></div> : null}</dl>
          <div className="mt-7 flex items-start gap-2 text-xs leading-5 text-zinc-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> Shared from the Marble Park document vault. Access can be revoked by the sender. Browser-visible media may still be saved.</div>
        </aside>
      </section>
    </main>
  );
}
