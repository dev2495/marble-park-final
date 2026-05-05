'use client';

import { useState } from 'react';
import { gql, useMutation, useQuery } from '@apollo/client';
import { Building2, Mail, MapPin, Phone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', city: '' });
  const { data, loading, refetch } = useQuery(GET_CUSTOMERS, { variables: { search } });
  const [createCustomer] = useMutation(CREATE_CUSTOMER);
  const customers = data?.customers || [];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await createCustomer({ variables: { input: formData } });
    setShowForm(false);
    setFormData({ name: '', email: '', phone: '', city: '' });
    refetch();
  };

  return (
    <div className="space-y-7 pb-10">
      <section className="rounded-[2.25rem] bg-[#211b16] p-7 text-white shadow-2xl shadow-[#211b16]/15">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">Customer master</p>
            <h1 className="mt-3 text-5xl font-black tracking-[-0.05em]">Architects, walk-ins and project buyers.</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#d9c4a9]">Keep site address, contact, city and design-owner context ready for quote and dispatch.</p>
          </div>
          <Button onClick={() => setShowForm((value) => !value)} size="lg" className="bg-[#fffaf3] text-[#211b16] hover:bg-white"><Plus className="mr-2 h-5 w-5" /> {showForm ? 'Close' : 'Add customer'}</Button>
        </div>
      </section>

      <section className="mp-card rounded-[2rem] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by customer, city, mobile..." className="h-[3.25rem] max-w-xl" />
          <p className="text-sm font-bold text-[#7d6b5c]">{customers.length} visible customers</p>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-[1.5rem] bg-white/65 p-4 md:grid-cols-4">
            <Input placeholder="Name" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} required />
            <Input placeholder="Email" type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} />
            <Input placeholder="Phone" value={formData.phone} onChange={(event) => setFormData({ ...formData, phone: event.target.value })} />
            <div className="flex gap-2"><Input placeholder="City" value={formData.city} onChange={(event) => setFormData({ ...formData, city: event.target.value })} /><Button type="submit">Save</Button></div>
          </form>
        )}
      </section>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {loading ? <div className="col-span-full rounded-[2rem] bg-white/70 p-12 text-center font-bold text-[#7d6b5c]">Loading customers...</div> : customers.map((customer: any) => (
          <article key={customer.id} className="mp-card rounded-[2rem] p-5 transition hover:-translate-y-1 hover:shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#211b16] text-lg font-black text-[#fffaf3]"><Building2 className="h-6 w-6" /></div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black text-[#211b16]">{customer.name}</h2>
                <p className="mt-1 truncate text-sm font-bold text-[#8b6b4c]">{customer.architect || 'Retail customer'}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm font-semibold text-[#5f4b3b]">
              {(customer.phone || customer.mobile) && <p className="flex items-center gap-3"><Phone className="h-4 w-4 text-[#b57942]" />{customer.phone || customer.mobile}</p>}
              {customer.email && <p className="flex items-center gap-3"><Mail className="h-4 w-4 text-[#b57942]" />{customer.email}</p>}
              {(customer.city || customer.siteAddress) && <p className="flex items-start gap-3"><MapPin className="mt-0.5 h-4 w-4 text-[#b57942]" />{[customer.siteAddress, customer.city].filter(Boolean).join(', ')}</p>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
