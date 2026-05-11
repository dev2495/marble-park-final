'use client';

import { useEffect, useMemo, useState } from 'react';
import { gql, useMutation, useQuery, useLazyQuery } from '@apollo/client';
import { AlertTriangle, Building2, Mail, MapPin, Phone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const GET_CUSTOMERS = gql`
  query Customers($search: String) {
    customers(search: $search) { id name email phone mobile city state architect siteAddress }
  }
`;

const CREATE_CUSTOMER = gql`
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) { id name }
  }
`;

const DUPLICATE_CANDIDATES = gql`
  query CustomerDuplicateCandidates($name: String, $email: String, $phone: String, $gstNo: String, $city: String) {
    customerDuplicateCandidates(name: $name, email: $email, phone: $phone, gstNo: $gstNo, city: $city)
  }
`;

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', city: '', gstNo: '' });
  const [forceCreate, setForceCreate] = useState(false);
  const [role, setRole] = useState<string>('');
  const { data, loading, error, refetch } = useQuery(GET_CUSTOMERS, { variables: { search } });
  const [createCustomer, { loading: creating, error: createError }] = useMutation(CREATE_CUSTOMER);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [probeDuplicates, { data: dupData }] = useLazyQuery(DUPLICATE_CANDIDATES, { fetchPolicy: 'network-only' });
  const customers = data?.customers || [];

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      setRole(u?.role || '');
    } catch {
      setRole('');
    }
  }, []);

  // Live duplicate probe — debounced when user fills in identity-strong fields.
  useEffect(() => {
    if (!showForm) return;
    const handle = setTimeout(() => {
      const hasSignal = formData.name.trim() || formData.phone.trim() || formData.email.trim() || formData.gstNo.trim();
      if (!hasSignal) return;
      probeDuplicates({
        variables: {
          name: formData.name || undefined,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          gstNo: formData.gstNo || undefined,
          city: formData.city || undefined,
        },
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [formData, showForm, probeDuplicates]);

  const duplicates: any[] = useMemo(() => dupData?.customerDuplicateCandidates || [], [dupData]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (duplicates.length > 0 && !forceCreate) {
      setSubmitError(new Error(`Possible duplicate of ${duplicates[0].name}. Tick "create anyway" to override (owner/admin only).`));
      return;
    }
    try {
      const { data: result, errors } = await createCustomer({ variables: { input: { ...formData, forceCreate: forceCreate || undefined } } });
      if (errors?.length) {
        setSubmitError(new Error(errors.map((e) => e.message).join(' • ')));
        return;
      }
      if (!result?.createCustomer) return;
      setShowForm(false);
      setFormData({ name: '', email: '', phone: '', city: '', gstNo: '' });
      setForceCreate(false);
      await refetch();
    } catch (err) {
      setSubmitError(err as Error);
    }
  };

  const canForceCreate = role === 'admin' || role === 'owner';

  return (
    <div className="space-y-7 pb-10">
      <section className="rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#bfdbfe]">Customer master</p>
            <h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Architects, walk-ins and project buyers.</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#dbeafe]">Keep site address, contact, city and design-owner context ready for quote and dispatch.</p>
          </div>
          <Button onClick={() => setShowForm((value) => !value)} size="lg" className="bg-[#ffffff] text-[#0e1a3d] hover:bg-white"><Plus className="mr-2 h-5 w-5" /> {showForm ? 'Close' : 'Add customer'}</Button>
        </div>
      </section>

      <section className="mp-card rounded-[2rem] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer, city, mobile..." className="h-[3.25rem] max-w-xl" />
          <p className="text-sm font-bold text-[#475569]">{customers.length} visible customers</p>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-[1.5rem] bg-white/65 p-4 md:grid-cols-4">
            <Input placeholder="Name" aria-label="Customer name" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} required />
            <Input placeholder="Email" aria-label="Customer email" type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} />
            <Input placeholder="Phone" aria-label="Customer phone" value={formData.phone} onChange={(event) => setFormData({ ...formData, phone: event.target.value })} required />
            <Input placeholder="City" aria-label="Customer city" value={formData.city} onChange={(event) => setFormData({ ...formData, city: event.target.value })} />
            <Input placeholder="GST number (optional)" aria-label="GST number" value={formData.gstNo} onChange={(event) => setFormData({ ...formData, gstNo: event.target.value })} className="md:col-span-3" />
            <Button type="submit" disabled={creating || (duplicates.length > 0 && !forceCreate)}>{creating ? 'Saving…' : 'Save'}</Button>

            {duplicates.length > 0 ? (
              <div role="alert" aria-live="polite" className="md:col-span-4 flex flex-col gap-2 rounded-2xl border border-amber-300 bg-amber-50/80 p-4 text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4" />
                  <div className="flex-1">
                    <p className="text-sm font-bold">Possible duplicate{duplicates.length > 1 ? 's' : ''} found</p>
                    <ul className="mt-2 space-y-1 text-xs font-bold">
                      {duplicates.map((dup) => (
                        <li key={dup.id} className="flex flex-wrap items-center gap-2">
                          <span className="text-[#0e1a3d]">{dup.name}</span>
                          <span className="text-amber-800/80">· {dup.city || 'no city'}</span>
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] uppercase tracking-wider">matched on {dup.matchedOn?.join(', ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {canForceCreate ? (
                  <label className="ml-6 flex items-center gap-2 text-xs font-bold">
                    <input type="checkbox" checked={forceCreate} onChange={(event) => setForceCreate(event.target.checked)} aria-label="Create anyway, ignore duplicates" />
                    <span>Create anyway (owner/admin override)</span>
                  </label>
                ) : (
                  <p className="ml-6 text-xs font-bold text-amber-800/80">Only owners/admins can override the duplicate guard.</p>
                )}
              </div>
            ) : null}

            {(submitError || createError) ? (
              <div className="md:col-span-4">
                <QueryErrorBanner error={(submitError as any) || createError!} />
              </div>
            ) : null}
          </form>
        )}
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {loading && !data ? <div role="status" aria-live="polite" className="col-span-full rounded-[2rem] bg-white/70 p-12 text-center font-bold text-[#475569]">Loading customers...</div> : customers.map((customer: any) => (
          <article key={customer.id} className="mp-card rounded-[2rem] p-5 transition hover:-translate-y-1 hover:shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#0e1a3d] text-lg font-black text-[#ffffff]"><Building2 className="h-6 w-6" /></div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black text-[#0e1a3d]">{customer.name}</h2>
                <p className="mt-1 truncate text-sm font-bold text-[#475569]">{customer.architect || 'Retail customer'}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm font-semibold text-[#1e293b]">
              {(customer.phone || customer.mobile) && <p className="flex items-center gap-3"><Phone className="h-4 w-4 text-[#2563eb]" />{customer.phone || customer.mobile}</p>}
              {customer.email && <p className="flex items-center gap-3"><Mail className="h-4 w-4 text-[#2563eb]" />{customer.email}</p>}
              {(customer.city || customer.siteAddress) && <p className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 text-[#2563eb]" />{[customer.siteAddress, customer.city].filter(Boolean).join(', ')}</p>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
