'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, gql } from '@apollo/client';
import { ArrowRight, CheckCircle2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [login] = useMutation(LOGIN_MUTATION);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await login({ variables: { input: { email: email.trim(), password } } });
      if (data?.login?.token) {
        localStorage.setItem('auth_token', data.login.token);
        localStorage.setItem('user', JSON.stringify(data.login.user));
        localStorage.removeItem('role_override');
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
        <section className="relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-[#dbe3f3] bg-[#eef3ff] p-10 lg:flex xl:p-14">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(37,99,235,0.18),transparent_32%),radial-gradient(circle_at_85%_92%,rgba(124,58,237,0.14),transparent_30%)]" />
          <Link href="/" className="relative flex w-max items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#2563eb] text-sm font-black text-white shadow-[0_18px_42px_-20px_rgba(37,99,235,0.75)]">MP</div>
            <div>
              <div className="text-2xl font-black tracking-tight text-[#18181b]">Marble Park</div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#64748b]">Retail OS</div>
            </div>
          </Link>

          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#bfdbfe] bg-white/80 px-3 py-1 text-[11px] font-bold text-[#1d4ed8] shadow-sm">
              <CheckCircle2 className="h-3 w-3" /> Built for Marble Park stores
            </span>
            <h1 className="mt-5 text-5xl font-black leading-[0.95] tracking-[-0.055em] text-[#111827] xl:text-[5.25rem]">
              Retail inventory that sells the product before the quote is sent.
            </h1>
            <p className="mt-6 max-w-xl text-lg font-semibold leading-8 text-[#665f52]">
              A full CRM, catalogue, inward, quote, dispatch, and owner dashboard system for sanitaryware, faucets, sinks, tiles, and project retail operations.
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-3">
            {[
              ['Catalogue', 'Browse image-led SKUs before quoting'],
              ['Inventory', 'Reserve, inward and dispatch with trace'],
              ['CRM', 'Lead to quote to order in one flow'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl border border-white/70 bg-white/82 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.45)] backdrop-blur">
                <div className="text-xl font-black tabular-nums text-[#18181b]">{value}</div>
                <div className="mt-1 text-xs font-semibold leading-5 text-[#665f52]">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center bg-[#fafafa] p-5 lg:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(37,99,235,0.06),transparent_34%),radial-gradient(circle_at_20%_90%,rgba(16,185,129,0.06),transparent_32%)]" />
          <div className="relative w-full max-w-md rounded-3xl border border-[#e4e4e7] bg-white p-7 shadow-[0_24px_80px_-44px_rgba(24,24,27,0.38)] sm:p-9">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717a]">Secure sign in</p>
                <h2 className="mt-1.5 text-3xl font-black tracking-[-0.035em] text-[#18181b]">Sign in to your workspace</h2>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#eff6ff] text-[#2563eb]">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                  {error}
                </div>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#52525b]">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="Enter your work email"
                    className="h-11 w-full rounded-xl border border-[#e4e4e7] bg-white pl-9 pr-3 text-sm font-semibold text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-4 focus:ring-[rgba(37,99,235,0.14)]"
                  />
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-[#52525b]">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="h-11 w-full rounded-xl border border-[#e4e4e7] bg-white pl-9 pr-3 text-sm font-semibold text-[#18181b] placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-4 focus:ring-[rgba(37,99,235,0.14)]"
                  />
                </div>
              </label>

              <Button type="submit" disabled={loading} size="lg" className="h-12 w-full gap-2 rounded-xl bg-[#2563eb] text-white hover:bg-[#1d4ed8]">
                {loading ? 'Signing in…' : 'Start workspace'} <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <p className="mt-5 text-center text-xs font-semibold leading-5 text-[#71717a]">
              Credentials are created by your admin or owner. Default demo values are not exposed on the live sign-in screen.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
