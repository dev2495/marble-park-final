'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, gql } from '@apollo/client';
import { ArrowRight, Bath, Boxes, CheckCircle2, Eye, EyeOff, Lock, Mail, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/company-logo';

// ──────────────────────────────────────────────────────────────────────────
// Login page — HARDCODED safe colors. CSS variables intentionally NOT used
// here because the previous deploy exposed a real-world failure mode: the
// build pipeline (Tailwind purge + Next.js CSS extraction) can occasionally
// drop arbitrary `bg-[var(--…)]` classes if a font import is still loading
// when first paint runs, which is exactly what hit this page on Railway
// (white text on dark navy because the var didn't resolve). All critical
// surfaces below use direct hex codes so contrast is impossible to fail.
// ──────────────────────────────────────────────────────────────────────────

const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      authenticated
      token
      user { id name email role }
    }
  }
`;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [login] = useMutation(LOGIN_MUTATION);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);
    try {
      const { data, errors } = await login({ variables: { input: { email: email.trim(), password } } });
      if (data?.login?.authenticated && data?.login?.user) {
        localStorage.setItem('user', JSON.stringify(data.login.user));
        // A document navigation lets Safari commit the HttpOnly Set-Cookie
        // response before the dashboard's session query starts.
        window.location.replace('/dashboard');
        return;
      } else {
        setError(errors?.[0]?.message || 'Login did not establish a session.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#111111] text-white">
      <div className="relative grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-white/10 bg-[#0d0d0d] p-10 lg:flex xl:p-14">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(157,42,36,0.18),transparent_46%),linear-gradient(0deg,rgba(255,255,255,0.02),rgba(255,255,255,0.02))]" />
          <div className="absolute left-10 top-36 h-px w-[78%] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <Link href="/" className="relative z-10 flex w-max items-center gap-3">
            <CompanyLogo className="h-14 w-14" imageClassName="p-0.5" />
            <div>
              <div className="text-xl font-bold tracking-tight text-white">Marble Park</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d7aaa6]">Retail OS</div>
            </div>
          </Link>

          <div className="relative z-10 max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#bd4b44]/30 bg-[#9d2a24]/15 px-3 py-1 text-xs font-semibold text-[#f0c5c1]">
              <CheckCircle2 className="h-3.5 w-3.5" /> Built for sanitaryware & tile retail
            </span>
            <h1 className="mt-8 max-w-4xl text-5xl font-black leading-[1.04] tracking-[-0.035em] text-white xl:text-[4.45rem]">
              One system for every quote, every SKU, every sale.
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-slate-300">
              Leads → Quotes → Orders → Dispatch, with real-time stock truth and procurement control under one roof.
            </p>
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-8 border-t border-white/10 pt-8">
            {[
              ['Brand-led', 'Quotation PDFs'],
              ['Lot-wise', 'Stock trace'],
              ['Partial', 'Order & dispatch'],
            ].map(([value, label]) => (
              <div key={label}>
                <div className="text-2xl font-black tabular-nums text-white">{value}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
              </div>
            ))}
          </div>

          <div className="relative z-10 grid grid-cols-3 gap-3">
            {[
              [Bath, 'Catalogue', 'Image-led SKU browsing before quoting'],
              [Boxes, 'Inventory', 'GRN, reserve and dispatch with trace'],
              [Users, 'CRM', 'Lead to confirmed order in one flow'],
            ].map(([Icon, title, label]: any) => (
              <div key={title} className="rounded-xl border border-white/10 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <Icon className="h-5 w-5 text-[#d7aaa6]" />
                <div className="mt-6 text-sm font-bold text-white">{title}</div>
                <div className="mt-2 text-xs leading-5 text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center bg-[#161616] p-5 lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(155deg,rgba(157,42,36,0.13),transparent_42%)]" />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.055] p-7 shadow-[0_30px_80px_-46px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-9">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Secure sign in</p>
                <h2 className="mt-2 text-3xl font-black leading-tight tracking-[-0.025em] text-white">Sign in to your workspace</h2>
              </div>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#9d2a24]/20 text-[#f0c5c1] ring-1 ring-[#bd4b44]/30">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div role="alert" className="rounded-md border border-red-400/25 bg-red-500/10 p-3 text-sm font-semibold text-red-100">
                  {error}
                </div>
              ) : null}

              <div className="block space-y-1.5">
                <label htmlFor="login-email" className="text-xs font-semibold text-slate-300">Email address</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="login-email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="Enter your work email"
                    className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.065] pl-9 pr-3 text-sm font-medium text-white placeholder:text-slate-500 focus:border-[#bd4b44] focus:outline-none focus:ring-2 focus:ring-[#9d2a24]/30"
                  />
                </div>
              </div>

              <div className="block space-y-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-300">Password</label>
                <div className="grid h-11 grid-cols-[minmax(0,1fr)_44px] overflow-hidden rounded-lg border border-white/10 bg-white/[0.065] focus-within:border-[#bd4b44] focus-within:ring-2 focus-within:ring-[#9d2a24]/30">
                  <div className="relative min-w-0">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="login-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      className="h-full w-full appearance-none border-0 bg-transparent pl-9 pr-3 text-sm font-medium text-white placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="relative z-10 grid h-full w-11 touch-manipulation place-items-center border-l border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#bd4b44]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={loading} size="lg" className="h-12 w-full gap-2 rounded-lg bg-[#9d2a24] font-bold text-white shadow-[0_18px_38px_-20px_rgba(157,42,36,0.9)] hover:bg-[#7f211d]">
                {loading ? 'Starting workspace…' : 'Start workspace'} <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="mt-8 border-t border-white/10 pt-6 text-center text-xs leading-5 text-slate-400">
              <p>Credentials are issued from User Management by an authorised admin or owner.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
