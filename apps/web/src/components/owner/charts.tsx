'use client';

import { useEffect, useRef, useState } from 'react';

const color = (name?: string, index = 0) => `var(--${name || `c${(index % 6) + 1}`})`;
const rupees = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
};
const count = (value: number) => Math.round(value).toLocaleString('en-IN');
const show = (value: number, kind?: string) => (kind === 'inr' ? rupees(value) : count(value));
const tick = (value: number, kind?: string) => (kind === 'inr' ? (value >= 1e7 ? `${(value / 1e7).toFixed(1)}Cr` : value >= 1e5 ? `${(value / 1e5).toFixed(value % 1e5 ? 1 : 0)}L` : value >= 1e3 ? `${value / 1e3}k` : String(value)) : count(value));
const niceMax = (max: number) => { if (max <= 0) return 1; const power = 10 ** Math.floor(Math.log10(max)); const m = max / power; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power; };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Legend({ items }: { items: Array<{ name: string; color?: string }> }) {
  return <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[var(--ink-3)]">{items.map((item, index) => <span key={item.name} className="inline-flex items-center"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color(item.color, index) }} />{item.name}</span>)}</div>;
}

export function BarsChart({ cats, series, kind, stacked, line, height = 240 }: any) {
  const [ref, W] = useWidth();
  const pl = 46; const pr = line ? 44 : 10; const pt = 12; const pb = 28; const iw = W - pl - pr; const ih = height - pt - pb;
  const totals = cats.map((_: any, i: number) => (stacked ? series.reduce((s: number, sr: any) => s + sr.data[i], 0) : Math.max(...series.map((sr: any) => sr.data[i]))));
  const max = niceMax(Math.max(...totals, 1));
  const gw = iw / Math.max(cats.length, 1);
  const bw = stacked ? Math.min(34, gw * 0.56) : Math.min(16, (gw * 0.56) / series.length);
  const every = Math.max(1, Math.ceil(cats.length / Math.max(1, Math.floor(iw / 62))));
  return (
    <div ref={ref} className="ox-chart mt-3.5 w-full">
      {W > 0 ? <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Chart of ${series.map((s: any) => s.name).join(', ')}`}>
        <g className="grid">{[0, 1, 2, 3, 4].map((t) => { const y = pt + ih - (ih * t) / 4; return <g key={t}><line x1={pl} x2={W - pr} y1={y} y2={y} /><text x={pl - 8} y={y + 4} textAnchor="end">{tick((max * t) / 4, kind)}</text></g>; })}</g>
        {cats.map((cat: string, i: number) => {
          const cx = pl + gw * i + gw / 2; let top = pt + ih;
          return <g key={`${cat}-${i}`}>{series.map((sr: any, k: number) => {
            const value = sr.data[i]; const bh = (ih * value) / max; const x = stacked ? cx - bw / 2 : cx - (bw * series.length) / 2 + k * bw; const y = stacked ? top - bh : pt + ih - bh; if (stacked) top -= bh;
            return <rect key={sr.name} className="ox-bar" x={x} y={y} width={Math.max(bw - 1, 1)} height={bh} rx={3} fill={color(sr.color, k)} style={{ animationDelay: `${i * 40}ms` }}><title>{`${cat} · ${sr.name}: ${show(value, kind)}`}</title></rect>;
          })}{i % every === 0 ? <text x={cx} y={height - 8} textAnchor="middle">{cat}</text> : null}</g>;
        })}
        {line ? (() => { const pts = line.data.map((v: number, i: number) => [pl + gw * i + gw / 2, pt + ih - ih * (v || 0)]); return <g><path className="ox-line" pathLength={1} d={pts.map((p: number[], i: number) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')} fill="none" stroke="var(--c2)" strokeWidth={2.2} strokeLinejoin="round" />{pts.map((p: number[], i: number) => <circle key={i} className="ox-dot" cx={p[0]} cy={p[1]} r={3.5} fill="var(--surface)" stroke="var(--c2)" strokeWidth={2} style={{ animationDelay: `${300 + i * 60}ms` }}><title>{`${cats[i]} · ${line.name}: ${Math.round(line.data[i] * 100)}%`}</title></circle>)}{[0, 1, 2].map((t) => <text key={t} x={W - pr + 8} y={pt + ih - (ih * t) / 2 + 4}>{t * 50}%</text>)}</g>; })() : null}
      </svg> : <div style={{ height }} />}
    </div>
  );
}

export function HBarChart({ rows, kind, ghost, rowH = 34 }: any) {
  const [ref, W] = useWidth();
  const ll = Math.min(170, Math.max(92, W * 0.3)); const pr = 78; const iw = Math.max(W - ll - pr, 10); const h = rows.length * rowH + 8;
  const max = Math.max(...rows.map((r: any) => Math.max(r.v, r.g || 0)), 1);
  return (
    <div ref={ref} className="ox-chart mt-3.5 w-full">
      {W > 0 ? <svg viewBox={`0 0 ${W} ${h}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Ranked bars">
        {rows.map((r: any, i: number) => { const y = 4 + i * rowH; const bw = (iw * r.v) / max; const label = String(r.label); return <g key={`${label}-${i}`}>
          <text className="lbl" x={ll - 10} y={y + rowH / 2 + 4} textAnchor="end">{label.length > 22 ? `${label.slice(0, 21)}…` : label}<title>{label}</title></text>
          {ghost && r.g ? <rect x={ll} y={y + 6} width={(iw * r.g) / max} height={rowH - 12} rx={4} fill="var(--bg-soft)"><title>{`${label} · ${ghost}: ${show(r.g, kind)}`}</title></rect> : null}
          <rect className="ox-hbar" x={ll} y={y + 8} width={bw} height={rowH - 16} rx={4} fill={color(r.color || 'c1')} style={{ animationDelay: `${i * 45}ms` }}><title>{`${label}: ${show(r.v, kind)}`}</title></rect>
          <text x={ll + bw + 8} y={y + rowH / 2 + 4}>{r.vl || show(r.v, kind)}</text></g>; })}
      </svg> : <div style={{ height: h }} />}
    </div>
  );
}

export function DonutChart({ slices, kind, center }: any) {
  const size = 220; const c = size / 2; const r = c - 14; const total = slices.reduce((s: number, x: any) => s + x.v, 0) || 1; let offset = 0;
  return (
    <div className="ox-chart mt-3.5">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block h-auto w-full" style={{ maxWidth: size }} role="img" aria-label={`Share: ${slices.map((s: any) => `${s.label} ${Math.round((s.v / total) * 100)}%`).join(', ')}`}>
        {slices.map((slice: any, i: number) => { const f = slice.v / total; const el = <circle key={slice.label} className="ox-arc" r={r} cx={c} cy={c} fill="none" stroke={color(slice.color, i)} strokeWidth={22} pathLength={1} strokeDasharray={`${f} ${1 - f}`} strokeDashoffset={-offset} transform={`rotate(-90 ${c} ${c})`} style={{ animationDelay: `${i * 110}ms` }}><title>{`${slice.label}: ${show(slice.v, kind || 'inr')} (${Math.round(f * 100)}%)`}</title></circle>; offset += f; return el; })}
        <text x={c} y={c - 2} textAnchor="middle" style={{ fontFamily: 'var(--f-display)', fontSize: 22, fill: 'var(--ink)', fontWeight: 600 }}>{center?.[0]}</text>
        <text x={c} y={c + 18} textAnchor="middle">{center?.[1]}</text>
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-xs text-[var(--ink-3)]">{slices.map((slice: any, i: number) => <span key={slice.label} className="inline-flex items-center"><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color(slice.color, i) }} />{slice.label} · {Math.round((slice.v / total) * 100)}%</span>)}</div>
    </div>
  );
}

export function ScatterPlot({ pts, height = 240 }: any) {
  const [ref, W] = useWidth();
  const pl = 42; const pr = 12; const pt = 14; const pb = 30; const iw = W - pl - pr; const ih = height - pt - pb; const mx = 0.25;
  const maxSize = Math.max(...pts.map((p: any) => p.size), 1);
  return (
    <div ref={ref} className="ox-chart mt-3.5 w-full">
      {W > 0 ? <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Discount against conversion by salesperson">
        <g className="grid">{[0, 0.5, 1].map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={pt + ih - ih * t} y2={pt + ih - ih * t} /><text x={pl - 8} y={pt + ih - ih * t + 4} textAnchor="end">{t * 100}%</text></g>)}{[0, 0.05, 0.1, 0.15, 0.2, 0.25].map((t) => <text key={t} x={pl + (iw * t) / mx} y={height - 8} textAnchor="middle">{Math.round(t * 100)}%</text>)}</g>
        <text x={pl + 6} y={pt + 12} style={{ fill: 'var(--ox-ok)', fontSize: 12 }}>Converts without discount</text>
        <text x={W - pr} y={pt + ih - 6} textAnchor="end" style={{ fill: 'var(--ox-bad)', fontSize: 12 }}>Discounting heavily</text>
        {pts.map((p: any, i: number) => { const x = pl + (iw * Math.min(p.x, mx)) / mx; const y = pt + ih - ih * (p.y || 0); const r = 8 + 14 * Math.sqrt(p.size / maxSize); return <g key={p.label}><circle className="ox-dot" cx={x} cy={y} r={r} fill={color(undefined, i)} fillOpacity={0.75} style={{ animationDelay: `${i * 90}ms` }}><title>{`${p.label} · discount ${(p.x * 100).toFixed(1)}% · converted ${Math.round(p.y * 100)}% · confirmed ${rupees(p.size)}`}</title></circle><text className="lbl" x={x} y={y - r - 5} textAnchor="middle">{String(p.label).split(' ')[0]}</text></g>; })}
      </svg> : <div style={{ height }} />}
      <Legend items={[]} /><p className="text-xs text-[var(--ink-3)]">Across: average discount below MRP · Up: confirmed out of sent · Size: confirmed value</p>
    </div>
  );
}

export function Heatmap({ rows, cols, cells, onPick }: any) {
  const max = Math.max(...cells.flat(), 1);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-separate text-xs" style={{ borderSpacing: 3 }}>
        <thead><tr><th />{cols.map((c: string) => <th key={c} className="whitespace-nowrap px-1.5 py-1 text-left font-medium text-[var(--ink-4)]">{c}</th>)}</tr></thead>
        <tbody>{rows.map((row: string, i: number) => <tr key={row}><th className="whitespace-nowrap px-1.5 py-1 text-left font-medium text-[var(--ink-4)]">{row}</th>{cells[i].map((value: number, j: number) => { const a = value / max; return <td key={cols[j]} className="ox-lift min-w-[68px] cursor-pointer rounded-md px-2 py-2 text-right" style={{ background: `color-mix(in srgb,var(--c1) ${Math.round(8 + a * 82)}%,var(--surface))`, color: a > 0.55 ? '#fff' : 'var(--ink)' }} title={`${row} × ${cols[j]}: ${rupees(value)}`} onClick={() => onPick?.(row, cols[j])}>{value ? rupees(value) : '·'}</td>; })}</tr>)}</tbody>
      </table>
    </div>
  );
}
