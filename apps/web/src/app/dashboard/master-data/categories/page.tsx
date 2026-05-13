'use client';

import { MasterEntityPage, statusOptions } from '../_components/master-entity-page';

const empty = { id: '', name: '', code: '', description: '', status: 'active', sortOrder: 0 };

export default function CategoryMasterPage() {
  return (
    <MasterEntityPage
      title="Category control for catalogue, inventory and quotes."
      eyebrow="Category master"
      description="Maintain the category list used by product creation, imports, catalogue filters and quote intent selection. Defaults are created automatically, and imported product categories are backfilled from real SKUs."
      icon="category"
      tone="brand"
      queryName="masterProductCategories"
      mutationName="saveProductCategory"
      mutationInputType="ProductCategoryInput"
      listTitle="Live categories"
      emptyLabel="No categories available"
      empty={empty}
      fields={[
        { key: 'name', label: 'Name', placeholder: 'Kitchen Sinks' },
        { key: 'code', label: 'Code', placeholder: 'KITCHEN_SINKS' },
        { key: 'description', label: 'Description', type: 'textarea', className: 'md:col-span-2' },
        { key: 'status', label: 'Status', type: 'select', options: statusOptions },
        { key: 'sortOrder', label: 'Sort order', type: 'number' },
      ]}
    />
  );
}
