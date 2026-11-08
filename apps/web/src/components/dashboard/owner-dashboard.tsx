'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { ArrowRight, Box, CheckCircle2, ClipboardCheck, Clock, DoorOpen, HeartPulse, PhoneCall, Truck } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';
import { Banner, ChartCard, KpiGrid, PeriodSwitch, Chip, inr, pct } from '@/components/owner/kit';

const DASHBOARD = gql`query OwnerCommandCenter($filters: OwnerReportFilters) { ownerCommandCenter(filters: $filters) }`;
const ICONS: Record<string, any> = { check: ClipboardCheck, door: DoorOpen, clock: Clock, phone: PhoneCall, box: Box, truck: Truck, heart: HeartPulse };
const TONES: Record<string, string> = { brand: 'bg-[var(--ox-brand-soft)] text-[var(--ox-brand-text)]', warn: 'bg-[var(--ox-warn-bg)] text-[var(--ox-warn)]', bad: 'bg-[var(--ox-bad-bg)] text-[var(--ox-bad)]', mute: 'bg-[var(--bg-soft)] text-[var(--ink-3)]' };

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function OwnerDashboard({ user }: { effectiveRole?: string; user?: any }) {
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filters = useMemo(() => (preset === 'custom' ? { preset, from: from || undefined, to: to || undefined } : { preset }), [preset, from, to]);
  const waitingForDates = preset === 'custom' && !(from && to);
  const { data, previousData, error, refetch, loading } = useQuery(DASHBOARD, { variables: { filters }, skip: waitingForDates, fetchPolicy: 'cache-and-network', pollInterval: 120000 });
  const d = (data || previousData)?.ownerCommandCenter;
  const chart = (key: string) => d?.charts?.find((row: any) => row.key === key);
  const first = String(user?.name || '').split(' ')[0];
  const dateText = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
  const asOf = d ? new Date(d.asOf).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const maxConf = Math.max(...(d?.leaderboard || []).map((row: any) => Math.max(row.conf, row.sent)), 1);
  const maxDemand = Math.max(...(d?.demand || []).map((row: any) => row.v), 1);
  return (
    <div className="ox space-y-[18px] pb-12">
      <section className="ox-card ox-hero p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-[var(--ink-4)]">{dateText} · Vapi</p>
            <h1 className="mt-1 font-display text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-[var(--ink)]">{greeting()}{first ? <>, <em className="text-[var(--ox-brand-text)]">{first}</em></> : null}.</h1>
            <p className="mt-1.5 text-sm text-[var(--ink-3)]">Here is how the showroom looks {d?.periodLabel || 'this month'}.{d ? ` Data since ${d.dataSince} · as of ${asOf}.` : ''}</p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <PeriodSwitch value={preset} onChange={setPreset} />
            {preset === 'custom' ? <><input type="date" aria-label="From date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)]" /><input type="date" aria-label="To date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)]" /></> : null}
          </div>
        </div>
      </section>
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {!d && loading ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ox-card h-[116px] animate-pulse bg-[var(--bg-soft)] motion-reduce:animate-none" />)}</div> : null}
      {d ? <div className={`ox-enter space-y-[18px] transition-opacity ${loading ? 'opacity-80' : ''}`}>
        <section aria-labelledby="needs-title">
          <h2 id="needs-title" className="mb-2.5 font-display text-lg font-medium text-[var(--ink)]">Needs you today</h2>
          <div className="ox-stagger grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {d.needs.length ? d.needs.map((item: any, index: number) => { const Icon = ICONS[item.i] || Box; return <Link key={item.t} href={item.href} className="ox-card ox-lift flex min-h-[64px] items-center gap-3 px-3.5 py-3" style={{ animationDelay: `${index * 50}ms` }}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${TONES[item.tone]}`}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span><span className="min-w-0"><b className="ox-num block text-xl leading-tight text-[var(--ink)]">{Number(item.n).toLocaleString('en-IN')}</b><span className="block text-[12.5px] leading-4 text-[var(--ink-3)]">{item.t}</span></span></Link>; }) : <div className="ox-card flex items-center gap-3 px-3.5 py-3"><span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--ox-ok-bg)] text-[var(--ox-ok)]"><CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" /></span><span><b className="ox-num block text-lg text-[var(--ink)]">Nothing waiting</b><span className="text-[12.5px] text-[var(--ink-3)]">All clear for now.</span></span></div>}
          </div>
        </section>
        {(d.notices || []).map((notice: any, index: number) => <Banner key={index} notice={notice} />)}
        <KpiGrid kpis={d.kpis} className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
        <KpiGrid kpis={d.moreKpis} small className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><ChartCard chart={chart('trend')} /><ChartCard chart={chart('cat')} /></div>
        <div className="grid gap-4 md:grid-cols-3"><ChartCard chart={chart('brand')} /><ChartCard chart={chart('health')} /><ChartCard chart={chart('status')} /></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="ox-card ox-lift min-w-0 p-4 sm:p-[18px]">
            <div className="flex items-center justify-between gap-2"><div><h3 className="font-display text-base font-semibold text-[var(--ink)]">Salesperson leaderboard</h3><p className="mt-0.5 text-xs text-[var(--ink-4)]">Confirmed value · conversion · average discount</p></div><Link href="/dashboard/reports/salespeople" className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[var(--line)] px-3 text-[13px] text-[var(--ink-2)]">Full report<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
            {d.leaderboard.length ? <div className="mt-3 grid gap-2.5">{d.leaderboard.map((row: any, index: number) => <div key={row.name} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"><span className="ox-num text-[var(--ink-4)]">{index + 1}</span><div className="min-w-0"><div className="flex justify-between gap-2"><strong className="truncate font-medium text-[var(--ink)]">{row.name}</strong><span className="text-[var(--ink-2)]">{inr(row.conf)}</span></div><div className="mt-1 h-2 overflow-hidden rounded bg-[var(--bg-soft)]"><div className="ox-hbar h-full rounded bg-[var(--c1)]" style={{ width: `${(100 * row.conf) / maxConf}%`, animationDelay: `${index * 80}ms` }} /></div></div><div className="text-right text-xs leading-4 text-[var(--ink-4)]">{pct(row.conv)} conv<br />{pct(row.disc, 1)} disc</div></div>)}</div> : <div className="grid min-h-[170px] place-items-center text-[13px] text-[var(--ink-4)]">No quotes sent in this period</div>}
          </section>
          <section className="ox-card ox-lift min-w-0 p-4 sm:p-[18px]">
            <div className="flex items-center justify-between gap-2"><div><h3 className="font-display text-base font-semibold text-[var(--ink)]">What people asked for most</h3><p className="mt-0.5 text-xs text-[var(--ink-4)]">Quote lines and showroom scans</p></div><Link href="/dashboard/reports/demand-gap" className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[var(--line)] px-3 text-[13px] text-[var(--ink-2)]">Full report<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
            {d.demand.length ? <div className="mt-3 grid gap-2.5">{d.demand.map((row: any, index: number) => <div key={row.label} className="min-w-0 text-[13px]"><div className="flex items-center justify-between gap-2"><span className="truncate text-[var(--ink-2)]">{row.label}</span>{row.status !== 'Healthy' ? <Chip value={row.status} /> : null}</div><div className="mt-1 h-2 overflow-hidden rounded bg-[var(--bg-soft)]"><div className="ox-hbar h-full rounded bg-[var(--c2)]" style={{ width: `${(100 * row.v) / maxDemand}%`, animationDelay: `${index * 60}ms` }} /></div></div>)}</div> : <div className="grid min-h-[170px] place-items-center text-[13px] text-[var(--ink-4)]">No demand recorded in this period</div>}
          </section>
        </div>
        <div className="grid gap-4 md:grid-cols-3"><ChartCard chart={chart('funnel')} /><ChartCard chart={chart('age')} /><ChartCard chart={chart('arch')} /></div>
        <ChartCard chart={chart('items')} />
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-4)]"><span>Last opening stock: {d.footer.lastOpening || 'none yet'}</span><span>Last GRN: {d.footer.lastGrn || 'none yet'}</span><span>Open purchase orders: {d.footer.openPo}</span></p>
      </div> : null}
    </div>
  );
}
