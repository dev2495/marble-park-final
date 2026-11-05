'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { ShowroomScanner } from './showroom-scanner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/graphql';
const VISIT_KEY = 'mp_showroom_visit';
const SKIP_KEY = 'mp_showroom_checkin_skipped';

type Visit = { token: string; name: string };

async function gql(query: string, variables: Record<string, unknown>) {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!response.ok) throw new Error('request failed');
  return response.json();
}

function readVisit(): Visit | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(VISIT_KEY) || 'null');
    return parsed && typeof parsed.token === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** The showroom poster page: a short, skippable check-in, then the scanner. */
export function ShowroomCheckIn() {
  const [ready, setReady] = useState(false);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', city: '', note: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = readVisit();
    try { setSkipped(sessionStorage.getItem(SKIP_KEY) === '1'); } catch { /* storage blocked */ }
    if (!stored) { setReady(true); return; }
    // A check-in lasts for one visit; an old one asks again.
    gql('query PublicShowroomVisit($t:String!){publicShowroomVisit(visitToken:$t)}', { t: stored.token })
      .then((body) => {
        if (body?.data?.publicShowroomVisit?.active) setVisit(stored);
        else { try { localStorage.removeItem(VISIT_KEY); } catch { /* ignore */ } }
      })
      .catch(() => setVisit(stored))
      .finally(() => setReady(true));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (form.name.trim().length < 2) { setError('Please enter your name.'); return; }
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').slice(-10))) { setError('Please enter a 10-digit mobile number.'); return; }
    setSaving(true);
    try {
      const body = await gql('mutation PublicShowroomCheckIn($i:ShowroomCheckInInput!){publicShowroomCheckIn(input:$i)}', { i: form });
      const result = body?.data?.publicShowroomCheckIn;
      if (!result?.visitToken) { setError(result?.error || body?.errors?.[0]?.message || 'We could not save your details. You can skip and keep browsing.'); return; }
      const next = { token: result.visitToken, name: result.name };
      try { localStorage.setItem(VISIT_KEY, JSON.stringify(next)); } catch { /* storage blocked: scans still work */ }
      setVisit(next);
    } catch {
      setError('We could not reach the showroom system. Check your internet, or skip for now.');
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* ignore */ }
    setSkipped(true);
  }

  function switchVisitor() {
    try { localStorage.removeItem(VISIT_KEY); sessionStorage.removeItem(SKIP_KEY); } catch { /* ignore */ }
    setVisit(null);
    setSkipped(false);
    setForm({ name: '', mobile: '', city: '', note: '' });
  }

  if (!ready) return <div className="mx-auto mt-10 flex justify-center" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin text-[var(--ink-4)]" aria-label="Loading" /></div>;

  if (visit || skipped) {
    return (
      <>
        <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-[var(--ink-3)]">
          {visit ? <><UserRound className="h-4 w-4" aria-hidden="true" /><span>Hi {visit.name}. The products you scan are saved for our team.</span></> : <span>Browsing without checking in.</span>}
          <button type="button" onClick={switchVisitor} className="h-11 px-1 font-semibold text-[var(--ink-2)] underline underline-offset-2">{visit ? 'Not you?' : 'Check in'}</button>
        </div>
        <ShowroomScanner visitToken={visit?.token} />
      </>
    );
  }

  const field = 'mt-1 h-12 w-full rounded-r4 border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-base text-[var(--ink)] outline-none focus:border-[var(--brand-400)]';
  return (
    <form onSubmit={submit} className="public-rise mx-auto mt-6 max-w-md space-y-4 rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft" noValidate>
      <div>
        <h2 className="font-display text-2xl font-semibold text-[var(--ink)]">Welcome! Tell us who you are</h2>
        <p className="mt-1 text-sm text-[var(--ink-3)]">We save the products you scan, so our team can share prices and options with you.</p>
      </div>
      <div>
        <label htmlFor="visit-name" className="text-sm font-semibold text-[var(--ink)]">Your name</label>
        <input id="visit-name" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} placeholder="Full name" />
      </div>
      <div>
        <label htmlFor="visit-mobile" className="text-sm font-semibold text-[var(--ink)]">Mobile number</label>
        <input id="visit-mobile" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} className={field} placeholder="10-digit mobile" />
      </div>
      <div>
        <label htmlFor="visit-city" className="text-sm font-semibold text-[var(--ink)]">Area or city <span className="font-normal text-[var(--ink-4)]">(optional)</span></label>
        <input id="visit-city" autoComplete="address-level2" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={field} placeholder="e.g. Vapi" />
      </div>
      <div>
        <label htmlFor="visit-note" className="text-sm font-semibold text-[var(--ink)]">What are you looking for? <span className="font-normal text-[var(--ink-4)]">(optional)</span></label>
        <input id="visit-note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className={field} placeholder="e.g. Bathroom tiles and faucets" />
      </div>
      {error ? <p role="alert" className="text-sm font-medium text-[var(--danger)]">{error}</p> : null}
      <button type="submit" disabled={saving} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ink)] font-semibold text-[var(--surface)] disabled:opacity-60">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Continue to scanning
      </button>
      <button type="button" onClick={skip} className="h-11 w-full text-sm font-semibold text-[var(--ink-3)] underline underline-offset-2">Skip for now</button>
      <p className="text-xs text-[var(--ink-4)]">We use your number only to contact you about your selection.</p>
    </form>
  );
}
