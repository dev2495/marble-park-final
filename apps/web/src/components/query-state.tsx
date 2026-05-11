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

function describeError(error: ApolloError | Error): string {
  if (!error) return 'Unknown error';
  if ('graphQLErrors' in error && error.graphQLErrors?.length) {
    return error.graphQLErrors.map((e) => e.message).join(' • ');
  }
  if ('networkError' in error && error.networkError) {
    return `Network: ${error.networkError.message || 'request failed'}`;
  }
  return error.message || 'Unknown error';
}

export function QueryErrorBanner({ error, onRetry }: { error: ApolloError | Error; onRetry?: () => unknown | Promise<unknown> }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-red-900 shadow-sm"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-bold tracking-tight">Couldn't load this view</p>
        <p className="text-xs font-medium leading-relaxed text-red-800/90">{describeError(error)}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={() => {
            void onRetry();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white/70 px-3 py-1.5 text-xs font-bold text-red-900 transition hover:bg-white"
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
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-white/60 p-6 text-sm font-bold text-[#8b6b4c]">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function QueryEmpty({ label = 'No records yet.' }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#e8c39b]/60 bg-white/40 p-8 text-center text-sm font-bold text-[#8b6b4c]">
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
