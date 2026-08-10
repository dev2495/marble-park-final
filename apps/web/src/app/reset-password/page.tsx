'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation } from '@apollo/client';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/company-logo';

const RESET_PASSWORD = gql`
  mutation ResetPassword($token: String!, $newPassword: String!) {
    resetPassword(token: $token, newPassword: $newPassword)
  }
`;

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [resetPassword, state] = useMutation(RESET_PASSWORD);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const oneTimeToken = fragment.get('token') || '';
    setToken(oneTimeToken);
    window.history.replaceState({}, '', '/reset-password');
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    if (!token) return setMessage('This reset link is missing or has already been removed. Ask an administrator for a new link.');
    if (password.length < 12) return setMessage('Use at least 12 characters. A passphrase is easiest to remember.');
    if (password !== confirmation) return setMessage('The two passwords do not match.');
    try {
      await resetPassword({ variables: { token, newPassword: password } });
      window.location.replace('/login?reason=password-reset');
    } catch (error: any) {
      setMessage(error?.message || 'This reset link is invalid or expired. Ask an administrator for a new link.');
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#111111] p-5 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.055] p-7 shadow-[0_30px_80px_-46px_rgba(0,0,0,0.9)] sm:p-9">
        <Link href="/" className="flex w-max items-center gap-3">
          <CompanyLogo className="h-11 w-11" imageClassName="p-0.5" />
          <div><div className="text-lg font-bold">Marble Park</div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d7aaa6]">Retail OS</div></div>
        </Link>
        <div className="mt-8 flex items-start justify-between gap-4">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Secure recovery</p><h1 className="mt-2 text-3xl font-black tracking-tight">Choose a new password</h1></div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#9d2a24]/20 text-[#f0c5c1] ring-1 ring-[#bd4b44]/30"><ShieldCheck className="h-5 w-5" /></div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">The link works once and expires after one hour. Completing it signs out every other browser session.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          {message ? <div role="alert" className="rounded-md border border-red-400/25 bg-red-500/10 p-3 text-sm font-semibold text-red-100">{message}</div> : null}
          {!token ? <div role="status" className="rounded-md border border-amber-300/25 bg-amber-400/10 p-3 text-sm text-amber-100">A valid one-time link is required.</div> : null}
          <label className="block space-y-1.5" htmlFor="new-password"><span className="text-xs font-semibold text-slate-300">New password</span><div className="grid h-11 grid-cols-[minmax(0,1fr)_44px] overflow-hidden rounded-lg border border-white/10 bg-white/[0.065] focus-within:border-[#bd4b44] focus-within:ring-2 focus-within:ring-[#9d2a24]/30"><div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/><input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} className="h-full w-full bg-transparent pl-9 pr-3 text-sm outline-none"/></div><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="grid place-items-center border-l border-white/10 text-slate-400 hover:text-white">{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></label>
          <label className="block space-y-1.5" htmlFor="confirm-password"><span className="text-xs font-semibold text-slate-300">Confirm password</span><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/><input id="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.065] pl-9 pr-3 text-sm outline-none focus:border-[#bd4b44] focus:ring-2 focus:ring-[#9d2a24]/30"/></div></label>
          <Button type="submit" disabled={!token || state.loading} size="lg" className="h-12 w-full gap-2 rounded-lg bg-[#9d2a24] font-bold text-white hover:bg-[#7f211d]">{state.loading ? 'Updating password…' : 'Update password'}<ArrowRight className="h-4 w-4"/></Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">Did not request this? Close the page; no password is changed until submission.</p>
      </section>
    </main>
  );
}
