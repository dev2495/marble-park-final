import { redirect } from 'next/navigation';

export default function InventoryInwardsPage() {
  redirect('/dashboard/procurement?view=receiving');
}
