'use client';

import { MasterEntityPage, statusOptions } from '../_components/master-entity-page';

const empty = { id: '', name: '', phone: '', email: '', gstNo: '', address: '', city: '', state: '', contactPerson: '', category: '', status: 'active', notes: '' };

export default function VendorMasterPage() {
  return (
    <MasterEntityPage
      title="Supplier records for GRN, purchase and catalogue imports."
      eyebrow="Vendor master"
      description="Keep supplier contact, GST, city and category details current so inwards, catalogue uploads and purchase tracking can be traced to the correct vendor."
      icon="vendor"
      tone="warning"
      queryName="vendors"
      mutationName="saveVendor"
      mutationInputType="VendorInput"
      listTitle="Live vendors"
      emptyLabel="No vendors available"
      empty={empty}
      variant="vendor"
      fields={[
        { key: 'name', label: 'Vendor name', placeholder: 'Aquant India' },
        { key: 'contactPerson', label: 'Contact person' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gstNo', label: 'GST number' },
        { key: 'category', label: 'Category' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'address', label: 'Address', type: 'textarea', className: 'md:col-span-2' },
        { key: 'notes', label: 'Notes', type: 'textarea', className: 'md:col-span-2' },
        { key: 'status', label: 'Status', type: 'select', options: statusOptions },
      ]}
    />
  );
}
