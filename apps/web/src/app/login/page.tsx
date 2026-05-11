'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, gql } from '@apollo/client';
import { ArrowRight, Bath, Lock, Mail, PackageSearch, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <main className="min-h-screen overflow-hidden bg-[#0e1a3d] text-[#ffffff]">
      <div className="relative grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(59,130,246,0.40),transparent_30%),radial-gradient(circle_at_90%_80%,rgba(99,102,241,0.48),transparent_28%)]" />

        <section className="relative hidden min-h-screen flex-col justify-between p-10 lg:flex xl:p-14">
          <Link href="/" className="flex w-max items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#ffffff] text-xl font-black text-[#0e1a3d]">MP</div>
            <div>
              <div className="text-2xl font-black tracking-tight">Marble Park</div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#bfdbfe]">Retail Ops</div>
            </div>
          </Link>

          <div className="max-w-3xl">
            <h1 className="text-7xl font-black leading-[0.88] tracking-[-0.06em] xl:text-8xl">Catalogue, stock, CRM and quotes in one beautiful retail desk.</h1>
            <p className="mt-7 max-w-2xl text-lg font-semibold leading-8 text-[#dbeafe]">Built for sanitaryware, faucets, sinks, tiles, and project retail teams that need fast quoting and clean dispatch truth.</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              ['7k+', 'Imported catalogue SKUs'],
              ['6', 'Role workspaces'],
              ['1', 'Quote-to-dispatch flow'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-[1.75rem] border border-white/10 bg-white/[0.08] p-5 backdrop-blur">
                <div className="text-4xl font-black text-white">{value}</div>
                <div className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#bfdbfe]">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center p-5 lg:p-10">
          <div className="w-full max-w-lg rounded-[2.25rem] border border-white/12 bg-[#ffffff] p-6 text-[#0e1a3d] shadow-2xl shadow-black/30 sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#475569]">Secure sign in</p>
                <h2 className="mt-2 text-4xl font-black tracking-[-0.04em]">Open the store OS</h2>
              </div>
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#dbeafe] text-[#2563eb]"><ShieldCheck /></div>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-3">
              {[Bath, PackageSearch, ShieldCheck].map((Icon, index) => (
                <div key={index} className="grid h-24 place-items-center rounded-[1.5rem] bg-[#dbeafe]/70">
                  <Icon className="h-9 w-9 text-[#1d4ed8]" strokeWidth={1.45} />
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-[#475569]">Email</span>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#475569]" />
                  <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="h-14 rounded-2xl border-[#cbd5e1]/20 bg-white pl-12 text-base font-bold" required />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-[#475569]">Password</span>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#475569]" />
                  <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="h-14 rounded-2xl border-[#cbd5e1]/20 bg-white pl-12 text-base font-bold" required />
                </div>
              </label>

              <Button type="submit" disabled={loading} size="xl" className="w-full gap-3">
                {loading ? 'Opening workspace...' : 'Enter workspace'} <ArrowRight className="h-5 w-5" />
              </Button>
            </form>

            <p className="mt-6 rounded-2xl bg-[#dbeafe]/70 p-4 text-sm font-bold text-[#1e293b]">Demo is prefilled for admin: admin@marblepark.com / password123. Admin gets the role switcher; owner, sales, inventory and dispatch users use the same password.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
