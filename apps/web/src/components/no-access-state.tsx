'use client';

import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

/**
 * True when the API refused a query because this user's role or rights do not cover it
 * (FORBIDDEN, "This action is restricted"). A session that ran out is not a refusal here:
 * the shared error link already sends that user back to sign in.
 */
export function isAccessRefused(error: any): boolean {
  const errors: any[] = [
    ...(Array.isArray(error?.graphQLErrors) ? error.graphQLErrors : []),
    ...(Array.isArray(error?.networkError?.result?.errors) ? error.networkError.result.errors : []),
  ];
  return errors.some((item) => String(item?.extensions?.code || '').toUpperCase() === 'FORBIDDEN'
    || /this action is restricted|permission required/i.test(String(item?.message || '')));
}

/**
 * Calm "not for your role" screen, used where the menu shows a page whose data this role cannot read.
 * Access itself is not changed here: the owner decides who gets which right.
 *   <NoAccessState area="customer accounts" pageTitle="Customer accounts" />
 * With pageTitle it is a whole page (heading plus the message); without, it fills one section.
 */
export function NoAccessState({ area, pageTitle }: { area: string; pageTitle?: string }) {
  const message = (
    <div className="mp-panel">
      <EmptyState
        icon={Lock}
        title={`You do not have access to ${area}.`}
        description="Ask the owner if you need it."
      />
    </div>
  );
  if (!pageTitle) return message;
  return (
    <div className="space-y-5 pb-10">
      <PageHeader title={pageTitle} />
      {message}
    </div>
  );
}
