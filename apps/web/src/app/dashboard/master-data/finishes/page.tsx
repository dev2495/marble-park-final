'use client';

import { MasterEntityPage, statusOptions } from '../_components/master-entity-page';

const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0 };

export default function FinishMasterPage() {
  return (
    <MasterEntityPage
      title="Finish and colour values that stay consistent everywhere."
      eyebrow="Finish master"
      description="Control finish dropdowns for manual SKU creation, PDF/Excel import review, catalogue cards and quotation sections. Live rows are loaded from the production database."
      icon="finish"
      tone="violet"
      queryName="masterProductFinishes"
      mutationName="saveProductFinish"
      mutationInputType="ProductFinishInput"
      listTitle="Live finishes"
      emptyLabel="No finishes available"
      empty={empty}
      fields={[
        { key: 'name', label: 'Name', placeholder: 'Chrome' },
        { key: 'code', label: 'Code', placeholder: 'CHROME' },
        { key: 'description', label: 'Description', type: 'textarea', className: 'md:col-span-2' },
        { key: 'status', label: 'Status', type: 'select', options: statusOptions },
        { key: 'sortOrder', label: 'Sort order', type: 'number' },
      ]}
    />
  );
}
