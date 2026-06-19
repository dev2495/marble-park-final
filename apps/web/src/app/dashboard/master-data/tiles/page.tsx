'use client';

import { useMemo, useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Grid3X3, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const TILE_SIZES = gql`
  query TileSizes {
    tileSizes
  }
`;

const SAVE_TILE_SIZE = gql`
  mutation SaveTileSize($input: TileSizeInput!) {
    saveTileSize(input: $input) { data }
  }
`;

const empty = { id: '', name: '', code: '', uom: 'BOX', pcsPerBox: '' };

export default function TileMasterPage() {
  const { data, loading, error, refetch } = useQuery(TILE_SIZES);
  const [form, setForm] = useState<any>(empty);
  const [save, { loading: saving, error: saveError }] = useMutation(SAVE_TILE_SIZE, {
    onCompleted: () => {
      refetch();
      setForm(empty);
    },
  });
  const rows = useMemo<any[]>(() => data?.tileSizes || [], [data?.tileSizes]);
  const activeCount = useMemo(() => rows.filter((row: any) => row.status === 'active').length, [rows]);

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const submit = () => save({
    variables: {
      input: {
        id: form.id || undefined,
        name: form.name,
        code: form.code,
        uom: form.uom || undefined,
        pcsPerBox: form.pcsPerBox === '' ? undefined : Number(form.pcsPerBox || 0),
      },
    },
  });

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} /> : null}
      {saveError ? <QueryErrorBanner error={saveError} /> : null}

      <section className="mp-card relative overflow-hidden rounded-r6 border border-[var(--line)] p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(37,99,235,0.16),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(16,185,129,0.14),transparent_26%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--ink-4)]">Tile master</p>
            <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-[-0.045em] text-[var(--ink-1)]">
              Tile size and code control.
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[var(--ink-3)]">
              Only size name and code are mandatory. UOM and pcs-per-box are optional packing helpers; tile design codes remain customer-facing rows in intents and quotes.
            </p>
          </div>
          <div className="grid min-w-44 grid-cols-2 gap-3">
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)]/75 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Active</p>
              <p className="mt-2 text-3xl font-black text-[var(--ink-1)]">{activeCount}</p>
            </div>
            <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface)]/75 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ink-4)]">Total</p>
              <p className="mt-2 text-3xl font-black text-[var(--ink-1)]">{rows.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="mp-card rounded-r5 border border-[var(--line)] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eff6ff] text-[#2563eb]">
              <Grid3X3 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-[var(--ink-1)]">{form.id ? 'Edit tile size' : 'Add tile size'}</h2>
              <p className="text-sm font-bold text-[var(--ink-4)]">Used in lead intent tile rows.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Size name required</span>
              <Input value={form.name || ''} onChange={(event) => update('name', event.target.value)} placeholder="600 x 1200 mm" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Code required</span>
                <Input value={form.code || ''} onChange={(event) => update('code', event.target.value)} placeholder="600X1200" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">UOM optional</span>
                <select value={form.uom || 'BOX'} onChange={(event) => update('uom', event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink-1)]">
                  <option value="BOX">Box</option>
                  <option value="PC">Piece</option>
                </select>
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-widest text-[var(--ink-4)]">Pcs / box optional</span>
              <Input type="number" min={0} value={form.pcsPerBox ?? ''} onChange={(event) => update('pcsPerBox', event.target.value)} placeholder="Optional" />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={saving || !String(form.name || '').trim() || !String(form.code || '').trim()} onClick={submit}>
              <Save className="mr-2 h-4 w-4" />
              Save tile size
            </Button>
            <Button variant="outline" type="button" onClick={() => setForm(empty)}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>

        <div className="mp-card rounded-r5 border border-[var(--line)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-[var(--ink-1)]">Tile sizes</h2>
              <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">Click a row to edit. Product photos are not required for tile codes.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {rows.map((row: any) => (
              <button key={row.id} onClick={() => setForm(row)} className="rounded-3xl border border-[var(--line)] bg-[var(--surface)]/78 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-[var(--ink-1)]">{row.name}</p>
                    <p className="mt-1 text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">{row.code || 'No code'}</p>
                  </div>
                  <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-black text-[#1d4ed8]">{row.uom || 'BOX'}</span>
                </div>
                <p className="mt-3 text-sm font-bold text-[var(--ink-3)]">{Number(row.pcsPerBox || 0)} pcs / box</p>
              </button>
            ))}
          </div>
          {!loading && rows.length === 0 ? (
            <div className="mt-5 grid min-h-56 place-items-center rounded-3xl border border-dashed border-[var(--line)] text-center">
              <div>
                <Grid3X3 className="mx-auto h-9 w-9 text-[#2563eb]" />
                <p className="mt-3 font-black text-[var(--ink-1)]">No tile sizes yet.</p>
                <p className="mt-1 text-sm font-bold text-[var(--ink-4)]">Add the first tile size before taking tile intents.</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
