'use client';

import { MasterEntityPage, statusOptions } from '../_components/master-entity-page';

const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0, logoUrl: '' };

export default function BrandMasterPage() {
  return (
    <MasterEntityPage
      title="Brand master with quote-ready logo control."
      eyebrow="Brand master"
      description="Maintain every brand served by the store. Logo URLs saved here can be used inside quotation PDFs and product master dropdowns, while import review can assign missing brands cleanly."
      icon="brand"
      tone="success"
      queryName="masterProductBrands"
      mutationName="saveProductBrand"
      mutationInputType="ProductBrandInput"
      listTitle="Live brands"
      emptyLabel="No brands available"
      empty={empty}
      variant="brand"
      fields={[
        { key: 'name', label: 'Name', placeholder: 'Grohe' },
        { key: 'code', label: 'Code', placeholder: 'GROHE' },
        { key: 'logoUrl', label: 'Logo URL', placeholder: '/brand-logos/grohe.png', className: 'md:col-span-2' },
        { key: 'description', label: 'Description', type: 'textarea', className: 'md:col-span-2' },
        { key: 'status', label: 'Status', type: 'select', options: statusOptions },
        { key: 'sortOrder', label: 'Sort order', type: 'number' },
      ]}
    />
  );
}
