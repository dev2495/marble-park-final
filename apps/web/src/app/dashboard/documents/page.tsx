'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  Archive, ArchiveRestore, Check, ChevronRight, Copy, Download, File, FileImage, FileMusic,
  FileSpreadsheet, FileText, FileVideo, FolderOpen, Grid2X2, Link2, List,
  Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, UploadCloud, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { QueryErrorBanner, QueryLoading } from '@/components/query-state';
import { cn } from '@/lib/utils';

const DATA = gql`
  query DocumentVault($search: String, $category: String, $mediaKind: String, $status: String, $take: Float, $skip: Float, $jobTake: Int, $jobSkip: Int) {
    me { id role effectivePermissions }
    vaultAssets(search: $search, category: $category, mediaKind: $mediaKind, status: $status, take: $take, skip: $skip)
    vaultSummary
    documentJobs(take: $jobTake, skip: $jobSkip)
    productionReadinessSummary
  }
`;
const UPDATE = gql`mutation UpdateVaultAsset($assetId: ID!, $input: JSON!) { updateVaultAsset(assetId: $assetId, input: $input) }`;
const ARCHIVE = gql`mutation SetVaultAssetArchived($assetId: ID!, $archived: Boolean!) { setVaultAssetArchived(assetId: $assetId, archived: $archived) }`;
const SHARE = gql`mutation CreateVaultShare($assetId: ID!, $input: JSON!) { createVaultShare(assetId: $assetId, input: $input) }`;
const REVOKE = gql`mutation RevokeVaultShare($shareId: ID!) { revokeVaultShare(shareId: $shareId) }`;
const PURGE = gql`mutation DeleteVaultAssetPermanently($assetId: ID!) { deleteVaultAssetPermanently(assetId: $assetId) }`;

const DEFAULT_CATEGORIES = ['Catalogues', 'Tiles', 'Sanitaryware', 'Bath fittings', 'Brand media', 'Showroom samples', 'Training', 'General'];
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov,.mp3,.m4a,.wav';
const API_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || '').origin; } catch { return ''; }
})();
const vaultEndpoint = (path: string) => `${API_ORIGIN}${path}`;

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function fileIcon(kind: string, className = 'h-5 w-5') {
  if (kind === 'image') return <FileImage className={className} />;
  if (kind === 'video') return <FileVideo className={className} />;
  if (kind === 'audio') return <FileMusic className={className} />;
  if (kind === 'pdf') return <FileText className={className} />;
  return <FileSpreadsheet className={className} />;
}

function activeShare(share: any) {
  return !share.revokedAt && (!share.expiresAt || new Date(share.expiresAt) > new Date());
}

function graphError(error: any) {
  return error?.graphQLErrors?.[0]?.message || error?.networkError?.result?.errors?.[0]?.message || error?.message || 'The request could not be completed.';
}

function tone(status?: string) {
  if (String(status).includes('generated')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

export default function DocumentCenterPage() {
  const pageSize = 48;
  const [tab, setTab] = useState<'vault' | 'generated'>('vault');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [category, setCategory] = useState('all');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [jobPage, setJobPage] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadCategory, setUploadCategory] = useState('Catalogues');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [edit, setEdit] = useState({ title: '', category: '', description: '' });
  const [expiry, setExpiry] = useState('7');
  const [allowDownload, setAllowDownload] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const variables = {
    search: deferredSearch || undefined,
    category,
    mediaKind: kind,
    status,
    take: pageSize + 1,
    skip: page * pageSize,
    jobTake: pageSize + 1,
    jobSkip: jobPage * pageSize,
  };
  const { data, loading, error, refetch } = useQuery(DATA, { variables, fetchPolicy: 'cache-and-network' });
  const [updateAsset, updateState] = useMutation(UPDATE);
  const [archiveAsset, archiveState] = useMutation(ARCHIVE);
  const [createShare, shareState] = useMutation(SHARE);
  const [revokeShare, revokeState] = useMutation(REVOKE);
  const [purgeAsset, purgeState] = useMutation(PURGE);
  const assetRows: any[] = data?.vaultAssets || [];
  const hasNextPage = assetRows.length > pageSize;
  const assets = assetRows.slice(0, pageSize);
  const jobRows: any[] = data?.documentJobs || [];
  const hasNextJobPage = jobRows.length > pageSize;
  const jobs = jobRows.slice(0, pageSize);
  const summary: any = data?.vaultSummary || {};
  const readiness: any = data?.productionReadinessSummary || {};
  const permissions: string[] = data?.me?.effectivePermissions || [];
  const canManage = permissions.includes('documents.manage');
  const canPurge = permissions.includes('documents.delete');
  const selected = assets.find((asset) => asset.id === selectedId) || null;
  const categories = useMemo(() => Array.from(new Set([...DEFAULT_CATEGORIES, ...(summary.categories || []).map((row: any) => row.name)])).sort(), [summary.categories]);

  useEffect(() => {
    if (selected) setEdit({ title: selected.title || '', category: selected.category || 'General', description: selected.description || '' });
  }, [selected]);
  useEffect(() => {
    if (selectedId && !selected && !loading) setSelectedId('');
  }, [selectedId, selected, loading]);
  useEffect(() => {
    setPage(0);
  }, [deferredSearch, category, kind, status]);

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.size > 0);
    setUploadFiles((current) => [...current, ...next].slice(0, 20));
    setUploadOpen(true);
    setMessage(null);
  }

  function uploadOne(file: File) {
    return new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const body = new FormData();
      body.append('file', file);
      body.append('category', uploadCategory || 'General');
      body.append('description', uploadDescription);
      request.open('POST', vaultEndpoint('/api/document-vault/files'));
      request.withCredentials = true;
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress((current) => ({ ...current, [file.name]: Math.round(event.loaded / event.total * 100) }));
      };
      request.onerror = () => reject(new Error(`${file.name}: network upload failed.`));
      request.onload = () => {
        let payload: any = {};
        try { payload = JSON.parse(request.responseText || '{}'); } catch { /* response handled below */ }
        if (request.status >= 200 && request.status < 300) resolve();
        else reject(new Error(payload.message || payload.error || `${file.name}: upload failed.`));
      };
      request.send(body);
    });
  }

  async function startUpload() {
    if (!uploadFiles.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of uploadFiles) await uploadOne(file);
      setMessage({ tone: 'success', text: `${uploadFiles.length} ${uploadFiles.length === 1 ? 'file' : 'files'} added to the vault.` });
      setUploadFiles([]);
      setUploadProgress({});
      setUploadDescription('');
      setUploadOpen(false);
      await refetch();
    } catch (uploadError: any) {
      setMessage({ tone: 'error', text: uploadError.message || 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  }

  async function saveMetadata() {
    if (!selected) return;
    setMessage(null);
    try {
      await updateAsset({ variables: { assetId: selected.id, input: edit } });
      setMessage({ tone: 'success', text: 'File details updated.' });
      await refetch();
    } catch (mutationError) { setMessage({ tone: 'error', text: graphError(mutationError) }); }
  }

  async function setArchived(archived: boolean) {
    if (!selected) return;
    if (archived && !window.confirm('Archive this file and revoke all of its public links?')) return;
    setMessage(null);
    try {
      await archiveAsset({ variables: { assetId: selected.id, archived } });
      setSelectedId('');
      setMessage({ tone: 'success', text: archived ? 'File archived and public links revoked.' : 'File restored to the library.' });
      await refetch();
    } catch (mutationError) { setMessage({ tone: 'error', text: graphError(mutationError) }); }
  }

  async function purge() {
    if (!selected || selected.status !== 'archived') return;
    if (!window.confirm(`Permanently delete “${selected.title}”? The file and its share links cannot be recovered.`)) return;
    try {
      await purgeAsset({ variables: { assetId: selected.id } });
      setSelectedId('');
      setMessage({ tone: 'success', text: 'Archived file permanently deleted and storage reclaimed.' });
      await refetch();
    } catch (mutationError) { setMessage({ tone: 'error', text: graphError(mutationError) }); }
  }

  async function makeShare() {
    if (!selected) return;
    const expiresAt = new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
    setMessage(null);
    try {
      const result = await createShare({ variables: { assetId: selected.id, input: { expiresAt, allowDownload } } });
      const token = result.data?.createVaultShare?.token;
      const url = `${window.location.origin}/share/documents/${token}`;
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'success', text: 'Public link created and copied.' });
      await refetch();
    } catch (mutationError) { setMessage({ tone: 'error', text: graphError(mutationError) }); }
  }

  async function copyShare(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/share/documents/${token}`);
    setMessage({ tone: 'success', text: 'Public link copied.' });
  }

  async function revoke(shareId: string) {
    try {
      await revokeShare({ variables: { shareId } });
      setMessage({ tone: 'success', text: 'Public link revoked.' });
      await refetch();
    } catch (mutationError) { setMessage({ tone: 'error', text: graphError(mutationError) }); }
  }

  const contentUrl = selected ? vaultEndpoint(`/api/document-vault/files/${selected.id}/content`) : '';

  return (
    <div className="min-w-0 space-y-5 pb-12">
      <header className="border-b border-[var(--line)] pb-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--brand-700)]"><FolderOpen className="h-4 w-4" /> File vault</div>
            <h1 className="mt-2 font-display text-3xl font-bold text-[var(--ink)] md:text-4xl">Every catalogue and sample, ready to present.</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">Keep large PDFs, product imagery, videos and working documents together. Preview them here or issue a controlled public link.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => refetch()} title="Refresh"><RefreshCw className="h-4 w-4" /><span className="ml-2">Refresh</span></Button>
            {canManage ? <Button onClick={() => setUploadOpen((open) => !open)}><Plus className="h-4 w-4" /><span className="ml-2">Add files</span></Button> : null}
          </div>
        </div>
        <div className="mt-5 flex gap-5 overflow-x-auto text-sm font-semibold">
          <button onClick={() => setTab('vault')} className={cn('border-b-2 pb-2', tab === 'vault' ? 'border-[var(--brand-600)] text-[var(--ink)]' : 'border-transparent text-[var(--ink-4)]')}>Vault library</button>
          <button onClick={() => setTab('generated')} className={cn('border-b-2 pb-2', tab === 'generated' ? 'border-[var(--brand-600)] text-[var(--ink)]' : 'border-transparent text-[var(--ink-4)]')}>Generated records</button>
        </div>
      </header>

      {message ? <div role="status" className={cn('flex items-start justify-between gap-3 rounded-lg border p-3 text-sm font-semibold', message.tone === 'success' ? 'border-emerald-200 bg-[var(--success-bg)] text-emerald-700' : 'border-red-200 bg-[var(--danger-bg)] text-red-700')}><span>{message.text}</span><button onClick={() => setMessage(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button></div> : null}
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      {tab === 'vault' ? <>
        {uploadOpen && canManage ? (
          <section className="grid gap-4 border-b border-[var(--line)] pb-5 lg:grid-cols-[1.3fr_0.7fr]">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
              className={cn('flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed px-5 py-8 text-center transition', dragging ? 'border-[var(--brand-600)] bg-[var(--brand-50)]' : 'border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--brand-400)]')}
            >
              <UploadCloud className="h-8 w-8 text-[var(--brand-600)]" />
              <span className="mt-3 text-sm font-bold text-[var(--ink)]">Drop files here or choose from this device</span>
              <span className="mt-1 max-w-xl text-xs leading-5 text-[var(--ink-4)]">PDF, Office, image, video and audio files. Up to {formatBytes(summary.maxFileBytes || 1024 ** 3)} each, 20 files per batch.</span>
              <input ref={fileInput} className="sr-only" type="file" multiple accept={ACCEPT} onChange={(event) => event.target.files && addFiles(event.target.files)} />
            </button>
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-[var(--ink-4)]">Category
                <Input list="vault-categories" className="mt-1" value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} />
                <datalist id="vault-categories">{categories.map((item) => <option value={item} key={item} />)}</datalist>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">Shared description for this batch
                <Textarea className="mt-1 min-h-20" value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} placeholder="Collection, brand, room or use" />
              </label>
              {uploadFiles.length ? <div className="max-h-40 space-y-2 overflow-y-auto border-y border-[var(--line)] py-2">{uploadFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-xs"><File className="h-4 w-4 shrink-0 text-[var(--ink-4)]" /><span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink)]">{file.name}</span><span className="text-[var(--ink-4)]">{uploadProgress[file.name] ?? formatBytes(file.size)}{typeof uploadProgress[file.name] === 'number' ? '%' : ''}</span><button disabled={uploading} onClick={() => setUploadFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X className="h-4 w-4" /></button></div>)}</div> : null}
              <div className="flex gap-2"><Button className="flex-1" onClick={startUpload} disabled={!uploadFiles.length || uploading}>{uploading ? 'Uploading…' : `Upload ${uploadFiles.length || ''} ${uploadFiles.length === 1 ? 'file' : 'files'}`}</Button><Button variant="ghost" onClick={() => { setUploadOpen(false); setUploadFiles([]); }} disabled={uploading}>Cancel</Button></div>
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] md:grid-cols-4">
          {[
            ['Files', summary.activeCount || 0],
            ['Storage used', formatBytes(summary.usedBytes || 0)],
            ['Available', formatBytes(Math.max(0, (summary.limitBytes || 0) - (summary.usedBytes || 0)))],
            ['Archived', summary.archivedCount || 0],
          ].map(([label, value]) => <div key={label} className="bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">{label}</p><p className="mt-1 text-xl font-bold text-[var(--ink)]">{value}</p></div>)}
        </section>

        <section className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search title, filename, category or notes" /></label>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select aria-label="File type" value={kind} onChange={(event) => setKind(event.target.value)} className="h-9 min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="all">All file types</option><option value="pdf">PDF</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="document">Office files</option></select>
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]"><option value="active">Active</option><option value="archived">Archived</option></select>
            <div className="flex rounded-md border border-[var(--line)] bg-[var(--surface)] p-0.5"><button className={cn('h-8 w-8 rounded', view === 'grid' && 'bg-[var(--bg-soft)]')} onClick={() => setView('grid')} title="Grid view"><Grid2X2 className="mx-auto h-4 w-4" /></button><button className={cn('h-8 w-8 rounded', view === 'list' && 'bg-[var(--bg-soft)]')} onClick={() => setView('list')} title="List view"><List className="mx-auto h-4 w-4" /></button></div>
          </div>
        </section>

        {loading && !assets.length ? <QueryLoading label="Opening file vault…" /> : null}
        <div className={cn('grid min-w-0 gap-5', selected && 'lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]')}>
          <section className="min-w-0">
            {assets.length ? <div className={cn(view === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3' : 'divide-y divide-[var(--line)] border-y border-[var(--line)]')}>
              {assets.map((asset) => {
                const shares = (asset.shares || []).filter(activeShare).length;
                return <button key={asset.id} onClick={() => setSelectedId(asset.id)} className={cn('group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]', view === 'grid' ? 'overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:shadow-md-soft' : 'grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 py-3', selectedId === asset.id && 'ring-2 ring-[var(--brand-400)]')}>
                  {view === 'grid' ? <div className="relative aspect-[16/10] overflow-hidden bg-[var(--bg-soft)]">{asset.mediaKind === 'image' ? <img src={vaultEndpoint(`/api/document-vault/files/${asset.id}/content`)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-[var(--brand-600)]">{fileIcon(asset.mediaKind, 'h-12 w-12')}</div>}<span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase text-white">{asset.extension.slice(1)}</span>{asset.mediaKind === 'video' ? <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black"><Play className="h-4 w-4 fill-current" /></span></span> : null}</div> : <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]">{fileIcon(asset.mediaKind)}</span>}
                  <div className={cn('min-w-0', view === 'grid' ? 'p-4' : '')}><p className="truncate text-sm font-bold text-[var(--ink)]">{asset.title}</p><p className="mt-1 truncate text-xs text-[var(--ink-4)]">{asset.category} · {formatBytes(asset.sizeBytes)}</p>{view === 'grid' ? <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-3 text-[11px] font-semibold text-[var(--ink-4)]"><span>{formatDate(asset.createdAt).split(',')[0]}</span><span>{shares ? `${shares} active ${shares === 1 ? 'link' : 'links'}` : 'Private'}</span></div> : null}</div>
                  {view === 'list' ? <ChevronRight className="h-4 w-4 text-[var(--ink-4)]" /> : null}
                </button>;
              })}
            </div> : !loading ? <div className="flex min-h-64 flex-col items-center justify-center border-y border-[var(--line)] text-center"><FolderOpen className="h-10 w-10 text-[var(--ink-5)]" /><p className="mt-3 text-sm font-bold text-[var(--ink)]">No files match this view</p><p className="mt-1 text-xs text-[var(--ink-4)]">Change the filters or add the first file.</p></div> : null}
            {assets.length ? <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-4"><p className="text-xs font-semibold text-[var(--ink-4)]">Page {page + 1} · up to {pageSize} files</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => { setSelectedId(''); setPage((current) => Math.max(0, current - 1)); }}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={!hasNextPage || loading} onClick={() => { setSelectedId(''); setPage((current) => current + 1); }}>Next</Button></div></div> : null}
          </section>

          {selected ? <aside className="fixed inset-0 z-50 min-w-0 overflow-y-auto bg-[var(--surface)] p-4 lg:sticky lg:top-20 lg:z-auto lg:max-h-[calc(100vh-7rem)] lg:border-l lg:border-[var(--line)] lg:bg-transparent lg:p-0 lg:pl-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase text-[var(--brand-700)]">{selected.category}</p><h2 className="mt-1 truncate text-xl font-bold text-[var(--ink)]">{selected.title}</h2><p className="mt-1 truncate text-xs text-[var(--ink-4)]">{selected.originalName} · {formatBytes(selected.sizeBytes)}</p></div><button onClick={() => setSelectedId('')} className="h-8 w-8 shrink-0 rounded-md hover:bg-[var(--bg-soft)]" title="Close details"><X className="mx-auto h-4 w-4" /></button></div>
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--line)] bg-[#171717]">
              {selected.mediaKind === 'image' ? <img src={contentUrl} alt={selected.title} className="max-h-[34rem] min-h-56 w-full object-contain" /> : null}
              {selected.mediaKind === 'pdf' ? <iframe src={contentUrl} title={selected.title} className="h-[34rem] w-full bg-white" /> : null}
              {selected.mediaKind === 'video' ? <video src={contentUrl} controls preload="metadata" className="max-h-[34rem] min-h-56 w-full bg-black" /> : null}
              {selected.mediaKind === 'audio' ? <div className="flex min-h-44 items-center px-5"><audio src={contentUrl} controls preload="metadata" className="w-full" /></div> : null}
              {selected.mediaKind === 'document' ? <div className="flex min-h-56 flex-col items-center justify-center p-6 text-center text-white">{fileIcon(selected.mediaKind, 'h-12 w-12')}<p className="mt-3 text-sm font-bold">Preview is not available for this file type.</p><a href={`${contentUrl}?download=1`} className="mt-4 inline-flex h-9 items-center rounded-md bg-white px-4 text-sm font-semibold text-black"><Download className="mr-2 h-4 w-4" /> Download</a></div> : null}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2"><Button asChild variant="outline"><a href={contentUrl} target="_blank" rel="noreferrer"><FolderOpen className="mr-2 h-4 w-4" /> Open</a></Button><Button asChild variant="outline"><a href={`${contentUrl}?download=1`}><Download className="mr-2 h-4 w-4" /> Download</a></Button></div>

            {canManage ? <>
              <div className="mt-6 border-t border-[var(--line)] pt-5"><div className="flex items-center gap-2"><Pencil className="h-4 w-4 text-[var(--brand-700)]" /><h3 className="text-sm font-bold text-[var(--ink)]">File details</h3></div><div className="mt-3 space-y-3"><label className="block text-xs font-semibold text-[var(--ink-4)]">Title<Input className="mt-1" value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Category<Input className="mt-1" list="edit-vault-categories" value={edit.category} onChange={(event) => setEdit({ ...edit, category: event.target.value })} /><datalist id="edit-vault-categories">{categories.map((item) => <option value={item} key={item} />)}</datalist></label><label className="block text-xs font-semibold text-[var(--ink-4)]">Description<Textarea className="mt-1 min-h-20" value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></label><Button className="w-full" onClick={saveMetadata} disabled={!edit.title.trim() || updateState.loading}><Check className="mr-2 h-4 w-4" /> Save details</Button></div></div>
              {selected.status === 'active' ? <div className="mt-6 border-t border-[var(--line)] pt-5"><div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-[var(--brand-700)]" /><h3 className="text-sm font-bold text-[var(--ink)]">Public presentation link</h3></div><p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">Anyone with an active link can view this file without signing in. Every new link must expire.</p><div className="mt-3 grid grid-cols-2 gap-2"><select value={expiry} onChange={(event) => setExpiry(event.target.value)} className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-xs font-semibold"><option value="1">Expires in 1 day</option><option value="7">Expires in 7 days</option><option value="30">Expires in 30 days</option><option value="90">Expires in 90 days</option></select><label className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-xs font-semibold"><input type="checkbox" checked={allowDownload} onChange={(event) => setAllowDownload(event.target.checked)} /> Show download button</label></div><p className="mt-2 text-[11px] leading-4 text-[var(--ink-5)]">Hiding the button discourages casual downloading, but any media visible in a browser can still be saved.</p><Button className="mt-2 w-full" onClick={makeShare} disabled={shareState.loading}><Link2 className="mr-2 h-4 w-4" /> Create and copy link</Button><div className="mt-3 space-y-2">{(selected.shares || []).filter(activeShare).map((share: any) => <div key={share.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md bg-[var(--bg-soft)] p-2 text-xs"><span className="min-w-0 truncate text-[var(--ink-3)]">{share.expiresAt ? `Expires ${formatDate(share.expiresAt)}` : 'Legacy link · no expiry'} · {share.viewCount} views</span><button onClick={() => copyShare(share.token)} title="Copy link"><Copy className="h-4 w-4" /></button><button onClick={() => revoke(share.id)} disabled={revokeState.loading} title="Revoke link"><X className="h-4 w-4 text-red-600" /></button></div>)}</div></div> : null}
              <div className="mt-6 space-y-2 border-t border-[var(--line)] pt-5">{selected.status === 'active' ? <Button variant="outline" className="w-full text-red-700" onClick={() => setArchived(true)} disabled={archiveState.loading}><Archive className="mr-2 h-4 w-4" /> Archive file</Button> : <><Button variant="outline" className="w-full" onClick={() => setArchived(false)} disabled={archiveState.loading}><ArchiveRestore className="mr-2 h-4 w-4" /> Restore file</Button>{canPurge ? <Button variant="destructive" className="w-full" onClick={purge} disabled={purgeState.loading}><X className="mr-2 h-4 w-4" /> Delete permanently</Button> : null}</>}</div>
            </> : <div className="mt-5 flex items-start gap-2 rounded-lg bg-[var(--bg-soft)] p-3 text-xs leading-5 text-[var(--ink-4)]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> You cannot edit or share files. Ask a document manager to archive a file before permanent deletion.</div>}
            {!canManage && canPurge && selected.status === 'archived' ? <Button variant="destructive" className="mt-5 w-full" onClick={purge} disabled={purgeState.loading}><X className="mr-2 h-4 w-4" /> Delete permanently</Button> : null}
          </aside> : null}
        </div>
      </> : <>
        <section className="grid gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] md:grid-cols-4">{[
          ['Readiness score', `${readiness.score || 0}%`], ['Document jobs', readiness.documents?.documentJobs || jobs.length], ['Payment receipts', readiness.payments?.paymentReceipts || 0], ['Dispatch records', (readiness.dispatch?.dispatchLines || 0) + (readiness.dispatch?.shipments || 0)],
        ].map(([label, value]) => <div key={label} className="bg-[var(--surface)] p-4"><p className="text-xs font-semibold uppercase text-[var(--ink-4)]">{label}</p><p className="mt-1 text-xl font-bold text-[var(--ink)]">{value}</p></div>)}</section>
        <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"><div className="flex items-center gap-2 border-b border-[var(--line)] p-4"><FileText className="h-5 w-5 text-[var(--brand-700)]" /><h2 className="font-bold text-[var(--ink)]">Quote, order and dispatch records</h2></div><div className="divide-y divide-[var(--line)]">{jobs.map((job) => <div key={job.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"><div><p className="text-sm font-bold text-[var(--ink)]">{job.documentType} · {job.entityType}</p><p className="mt-1 text-xs text-[var(--ink-4)]">{job.entityId} · {formatDate(job.updatedAt || job.createdAt)}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${tone(job.status)}`}>{job.status}</span>{job.url ? <Button asChild size="sm" variant="outline"><Link href={job.url} target="_blank">Open PDF</Link></Button> : null}</div></div>)}{!jobs.length && !loading ? <div className="p-10 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-emerald-600" /><p className="mt-3 text-sm font-semibold text-[var(--ink-3)]">No generated document jobs yet.</p></div> : null}</div>{jobs.length || jobPage > 0 ? <div className="flex items-center justify-between border-t border-[var(--line)] p-4"><p className="text-xs font-semibold text-[var(--ink-4)]">Page {jobPage + 1}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={jobPage === 0 || loading} onClick={() => setJobPage((current) => Math.max(0, current - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={!hasNextJobPage || loading} onClick={() => setJobPage((current) => current + 1)}>Next</Button></div></div> : null}</section>
      </>}
    </div>
  );
}
