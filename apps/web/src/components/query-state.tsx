'use client';

import { ApolloError } from '@apollo/client';
import { AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';
import { ReactNode } from 'react';

export interface QueryStateProps {
  loading?: boolean;
  error?: ApolloError | Error | null | undefined;
  hasData?: boolean;
  refetch?: () => unknown | Promise<unknown>;
  loadingLabel?: string;
  emptyLabel?: string;
  empty?: ReactNode;
  children?: ReactNode;
  /**
   * When true, render children even if `error` is set. Useful when an error
   * accompanies partial data (errorPolicy: 'all') and the page still wants to
   * show what loaded — the banner is rendered above children.
   */
  showChildrenOnError?: boolean;
}

function describeError(error: ApolloError | Error) {
  if (!error) return { title: 'Something went wrong', message: 'An unknown error occurred.', hint: 'Retry the request.' };
  if ('graphQLErrors' in error && error.graphQLErrors?.length) {
    const codes = error.graphQLErrors.map((item) => String(item.extensions?.code || '').toUpperCase());
    const message = error.graphQLErrors.map((item) => item.message).join(' • ');
    if (codes.includes('UNAUTHENTICATED')) return { title: 'Session expired', message, hint: 'Sign in again, then retry your last action.' };
    if (codes.includes('FORBIDDEN')) return { title: 'Permission required', message, hint: 'Ask an owner to grant the required role or permission.' };
    if (codes.some((code) => ['BAD_USER_INPUT', 'BAD_REQUEST'].includes(code)) || /required|invalid|unknown|duplicate|cannot|must|exceed/i.test(message)) {
      return { title: 'Check the entered information', message, hint: 'Correct the stated fields and submit again.' };
    }
    return { title: 'The request could not be completed', message, hint: 'No confirmed data was changed. Retry or contact the system owner.' };
  }
  if ('networkError' in error && error.networkError) {
    return { title: 'Cannot reach the server', message: error.networkError.message || 'The network request failed.', hint: 'Check connectivity and retry. Your unconfirmed form data remains on this page.' };
  }
  return { title: 'The request could not be completed', message: error.message || 'Unknown error', hint: 'Review the information and retry.' };
}

export function QueryErrorBanner({ error, onRetry }: { error: ApolloError | Error; onRetry?: () => unknown | Promise<unknown> }) {
  const detail = describeError(error);
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-r4 border border-red-200 bg-red-50/80 p-4 text-red-900 shadow-sm"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-bold">{detail.title}</p>
        <p className="text-xs font-medium leading-relaxed text-red-800/90">{detail.message}</p>
        <p className="text-xs leading-relaxed text-red-700/80">{detail.hint}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={() => {
            void onRetry();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white/70 px-3 py-1.5 text-xs font-bold text-red-900 transition hover:bg-white"
          aria-label="Retry loading"
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function QueryLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-white/60 p-6 text-sm font-bold text-[#52525b]">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function QueryEmpty({ label = 'No records yet.' }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#bfdbfe]/60 bg-white/40 p-8 text-center text-sm font-bold text-[#52525b]">
      {label}
    </div>
  );
}

/**
 * Single source of truth for the loading / error / empty triad on Apollo
 * queries. Pages render <QueryState ...>{data && <Real />}</QueryState>.
 */
export function QueryState({
  loading,
  error,
  hasData,
  refetch,
  loadingLabel,
  emptyLabel,
  empty,
  children,
  showChildrenOnError,
}: QueryStateProps) {
  if (loading && !hasData) return <QueryLoading label={loadingLabel} />;
  if (error && !hasData) return <QueryErrorBanner error={error} onRetry={refetch} />;
  if (error && showChildrenOnError) {
    return (
      <div className="space-y-3">
        <QueryErrorBanner error={error} onRetry={refetch} />
        {children}
      </div>
    );
  }
  if (!hasData) return empty ?? <QueryEmpty label={emptyLabel} />;
  return <>{children}</>;
}
