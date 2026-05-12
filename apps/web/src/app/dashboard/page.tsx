'use client';

import { useEffect, useState } from 'react';
import { OwnerDashboard } from '@/components/dashboard/owner-dashboard';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';
import { SalesManagerDashboard } from '@/components/dashboard/sales-manager-dashboard';
import { SalesRepDashboard } from '@/components/dashboard/sales-rep-dashboard';
import { InventoryManagerDashboard } from '@/components/dashboard/inventory-manager-dashboard';
import { DispatchOpsDashboard } from '@/components/dashboard/dispatch-ops-dashboard';
import { OfficeStaffDashboard } from '@/components/dashboard/office-staff-dashboard';

/**
 * /dashboard — role-aware command center.
 *
 * Every authenticated user lands here. We read the role (with an admin
 * "preview as" override) from localStorage and render a purpose-built
 * dashboard component. Each dashboard fetches its own focused GraphQL
 * query; there is no shared mega-query.
 *
 * Admin and Owner share the same command center because the data they care
 * about is identical at the executive level. (The role-switcher in the
 * topbar lets admins preview any other role's dashboard live.)
 */
export default function DashboardRouter() {
  const [user, setUser] = useState<any>(null);
  const [effectiveRole, setEffectiveRole] = useState<string>('owner');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      const override = localStorage.getItem('role_override');
      setUser(stored);
      setEffectiveRole(stored?.role === 'admin' && override ? override : stored?.role || 'owner');
    } catch {
      setEffectiveRole('owner');
    } finally {
      setReady(true);
    }
  }, []);

  if (!ready || !user) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-r5 border border-[#e4e4e7] bg-white" />
        ))}
      </div>
    );
  }

  // Common props passed into every dashboard.
  const props = { effectiveRole, user };

  switch (effectiveRole) {
    case 'admin':
      // Admin always sees the admin-specific command center (system health,
      // user activity, integrity flags). To preview another role, the
      // role-switcher in the topbar sets a different `role_override` —
      // which makes `effectiveRole` land on that role's case instead.
      return <AdminDashboard {...props} />;
    case 'owner':
      return <OwnerDashboard {...props} />;
    case 'sales_manager':
      return <SalesManagerDashboard {...props} />;
    case 'sales':
      return <SalesRepDashboard {...props} />;
    case 'inventory_manager':
      return <InventoryManagerDashboard {...props} />;
    case 'dispatch_ops':
      return <DispatchOpsDashboard {...props} />;
    case 'office_staff':
      return <OfficeStaffDashboard {...props} />;
    default:
      return <OwnerDashboard {...props} />;
  }
}
