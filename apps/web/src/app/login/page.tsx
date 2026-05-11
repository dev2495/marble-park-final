'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, gql } from '@apollo/client';
import { ArrowRight, CheckCircle2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  const router = useRouter();
  const [email, setEmail] = useState('admin@marblepark.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [login] = useMutation(LOGIN_MUTATION);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await login({ variables: { input: { email, password } } });
      if (data?.login?.token) {
        localStorage.setItem('auth_token', data.login.token);
        localStorage.setItem('user', JSON.stringify(data.login.user));
        router.push('/dashboard');
      } else {
        setError('Login did not return a session token.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#fafafa] text-[#18181b]">
      <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* LEFT — light grey marketing column. Hardcoded hex throughout. */}
        <section className="relative hidden min-h-screen flex-col justify-between border-r border-[#e4e4e7] bg-[#f4f4f5] p-10 lg:flex xl:p-14">
          <Link href="/" className="flex w-max items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-[#2563eb] text-sm font-bold text-white">MP</div>
            <div>
              <div className="text-xl font-bold tracking-tight text-[#18181b]">Marble Park</div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Retail Operations</div>
            </div>
          </Link>

          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
              <CheckCircle2 className="h-3 w-3" /> Built for Marble Park stores
            </span>
            <h1 className="mt-5 text-5xl font-bold leading-[1.05] tracking-[-0.02em] text-[#18181b] xl:text-[3.5rem]">
              One desk for catalogue, quotes, inventory & dispatch.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#52525b]">
              Built for sanitaryware, faucets, sinks and tile retail teams who need fast
              quoting, honest stock and clean dispatch truth — without losing the human touch.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['7,000+', 'Catalogue SKUs ready to quote'],
              ['Sub-second', 'Search across products & customers'],
              ['Single flow', 'Lead → quote → order → dispatch'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-[#e4e4e7] bg-white p-4">
                <div className="text-2xl font-bold tabular-nums text-[#18181b]">{value}</div>
                <div className="mt-1 text-xs leading-5 text-[#52525b]">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* RIGHT — sign-in form. */}
        <section className="relative flex min-h-screen items-center justify-center bg-[#fafafa] p-5 lg:p-10">
          <div className="w-full max-w-md rounded-2xl border border-[#e4e4e7] bg-white p-7 shadow-[0_4px_20px_-8px_rgba(24,24,27,0.10)] sm:p-9">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#71717a]">Secure sign in</p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-[-0.01em] text-[#18181b]">Sign in to your workspace</h2>
              </div>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#eff6ff] text-[#2563eb]">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#52525b]">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    required
                    autoFocus
                    className="h-10 w-full rounded-md border border-[#e4e4e7] bg-white pl-9 pr-3 text-sm text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-2 focus:ring-[rgba(37,99,235,0.35)]"
                  />
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#52525b]">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    required
                    className="h-10 w-full rounded-md border border-[#e4e4e7] bg-white pl-9 pr-3 text-sm text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-2 focus:ring-[rgba(37,99,235,0.35)]"
                  />
                </div>
              </label>

              <Button type="submit" disabled={loading} size="lg" className="w-full gap-2 bg-[#2563eb] text-white hover:bg-[#1d4ed8]">
                {loading ? 'Signing in…' : 'Continue'} <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="mt-6 rounded-md border border-[#e4e4e7] bg-[#fafafa] p-3 text-xs leading-5 text-[#52525b]">
              <p>
                <span className="font-semibold text-[#27272a]">Demo login</span> · admin@marblepark.com /
                password123. Admins get a role switcher; owner/sales/inventory/dispatch users share the
                same password.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
