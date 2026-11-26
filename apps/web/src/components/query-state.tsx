'use client';

import { ApolloError } from '@apollo/client';
import { AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';
import { ReactNode } from 'react';
import { describeApolloError } from '@/lib/apollo-errors';

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

export function QueryErrorBanner({ error, onRetry }: { error: ApolloError | Error; onRetry?: () => unknown | Promise<unknown> }) {
  const detail = describeApolloError(error);
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-r4 border border-[color-mix(in_srgb,var(--danger-border)_35%,transparent)] border-l-[3px] border-l-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-[var(--ink)] shadow-sm-soft"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--danger-fg)]" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-[var(--danger-fg)]">{detail.title}</p>
        <p className="text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">{detail.message}</p>
        <p className="text-[13px] leading-relaxed text-[var(--ink-3)]">{detail.hint}</p>
        {detail.code || detail.path || detail.requestId ? <p className="pt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-4)]">{[detail.code ? `Code ${detail.code}` : '', detail.path ? `Field ${detail.path}` : '', detail.requestId ? `Ref ${detail.requestId}` : ''].filter(Boolean).join(' · ')}</p> : null}
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={() => {
            void onRetry();
          }}
          className="mp-tap inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[13px] font-semibold text-[var(--ink)] shadow-sm-soft transition-colors hover:bg-[var(--bg-soft)]"
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
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-r5 border border-[var(--line)] bg-[var(--surface)]/70 p-5 text-sm font-medium text-[var(--ink-3)]">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-600)] motion-reduce:animate-[spin_1.6s_linear_infinite]" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function QueryEmpty({ label = 'No records yet.' }: { label?: string }) {
  return (
    <div role="status" className="rounded-r5 border border-dashed border-[var(--line-strong)] bg-[var(--surface-2)] p-8 text-center text-sm font-medium text-[var(--ink-4)]">
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
