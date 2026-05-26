'use client';

import { usePathname } from 'next/navigation';

// Maps current pathname → help topic id. Falls back to the overview topic.
const ROUTE_TOPIC: Array<[RegExp, string]> = [
  [/^\/dashboard\/leads/, 'leads'],
  [/^\/dashboard\/intents\/[^/]+/, 'leads'],
  [/^\/dashboard\/intents/, 'leads'],
  [/^\/dashboard\/quotes\/approvals/, 'approvals'],
  [/^\/dashboard\/quotes/, 'quotes'],
  [/^\/dashboard\/approvals/, 'approvals'],
  [/^\/dashboard\/orders/, 'orders'],
  [/^\/dashboard\/sales/, 'orders'],
  [/^\/dashboard\/payments/, 'payments'],
  [/^\/dashboard\/returns/, 'returns'],
  [/^\/dashboard\/dispatch/, 'dispatch'],
  [/^\/dashboard\/pending-inward/, 'pending-inward'],
  [/^\/dashboard\/inventory/, 'inventory'],
  [/^\/dashboard\/products/, 'inventory'],
  [/^\/dashboard\/customers\/[^/]+/, 'customers'],
  [/^\/dashboard\/customers/, 'customers'],
  [/^\/dashboard\/master-data\/vendors/, 'vendors'],
  [/^\/dashboard\/vendors/, 'vendors'],
  [/^\/dashboard\/purchase-orders/, 'vendors'],
  [/^\/dashboard\/procurement/, 'vendors'],
  [/^\/dashboard\/reports/, 'reports'],
  [/^\/dashboard\/audit/, 'audit'],
  [/^\/dashboard\/users/, 'users'],
  [/^\/dashboard\/targets/, 'targets'],
  [/^\/dashboard\/profile/, 'profile'],
  [/^\/dashboard\/settings/, 'settings'],
  [/^\/dashboard\/master-data/, 'settings'],
];

export function usePageHelpTopic(): string {
  const pathname = usePathname() || '';
  for (const [re, id] of ROUTE_TOPIC) {
    if (re.test(pathname)) return id;
  }
  return 'overview';
}
