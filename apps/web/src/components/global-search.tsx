'use client';

// Header search: one box for customers, quotes, orders, products, dispatch,
// invoices, purchasing, stock, documents and people. The server only returns
// what this person may open. Ctrl/⌘ K opens it from anywhere; on phones it
// opens as a full-screen sheet.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { cn } from '@/lib/utils';

const SEARCH_EVERYTHING = gql`query SearchEverything($query: String!) { searchEverything(query: $query) }`;

type Item = { id: string; kind: string; title: string; subtitle?: string; meta?: string; href: string };
type Group = { key: string; label: string; items: Item[]; moreHref?: string };
type Row = { id: string; href: string; label: string; item?: Item; more?: boolean };

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const term = query.replace(/\s+/g, ' ').trim();
  const debounced = useDebouncedValue(term, 250);
  const ready = debounced.length >= 2;
  const { data, previousData, loading } = useQuery(SEARCH_EVERYTHING, { variables: { query: debounced }, skip: !ready || !(open || sheet), fetchPolicy: 'cache-and-network' });
  const groups: Group[] = useMemo(() => ((data || previousData)?.searchEverything || []) as Group[], [data, previousData]);
  const waiting = term.length >= 2 && (term !== debounced || loading);

  // Flat list for the keyboard: every result, then each group's "see all".
  const rows: Row[] = useMemo(() => groups.flatMap((group) => [
    ...group.items.map((item) => ({ id: `${group.key}-${item.kind}-${item.id}`, href: item.href, label: item.title, item })),
    ...(group.moreHref ? [{ id: `${group.key}-more`, href: group.moreHref, label: `See all in ${group.label}`, more: true }] : []),
  ]), [groups]);
  useEffect(() => { setActive(0); }, [debounced]);

  const close = useCallback(() => { setOpen(false); setSheet(false); }, []);
  const go = useCallback((href: string) => { close(); setQuery(''); router.push(href); }, [close, router]);

  // Ctrl/⌘ K from anywhere.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (window.matchMedia('(min-width: 1024px)').matches) { setOpen(true); inputRef.current?.focus(); inputRef.current?.select(); }
        else setSheet(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Close the dropdown on a click outside it (no blur timers).
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  // Phone sheet: focus starts in the box, Tab stays inside, Escape clears the
  // text first and then closes, focus goes back to the search button.
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, sheet, {
    initialFocus: sheetInputRef,
    onEscape: () => { if (query) setQuery(''); else close(); },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, Math.max(rows.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { const row = rows[active] || rows[0]; if (row) { event.preventDefault(); go(row.href); } }
    else if (event.key === 'Escape') { if (query) setQuery(''); else { close(); (event.target as HTMLInputElement).blur(); } }
  };

  const results = (
    <Results listId={listId} term={term} ready={term.length >= 2} waiting={waiting} groups={groups} rows={rows} active={active} onHover={setActive} onGo={go} />
  );
  const inputProps = {
    value: query,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setOpen(true); },
    onKeyDown,
    'aria-autocomplete': 'list' as const,
    'aria-controls': listId,
    'aria-activedescendant': rows[active] ? `${listId}-${rows[active].id}` : undefined,
    type: 'search',
    enterKeyHint: 'search' as const,
    autoComplete: 'off',
    spellCheck: false,
    placeholder: 'Search customer, mobile, quote, order, SKU…',
    'aria-label': 'Search everything',
  };

  return (
    <>
      {/* Desktop: inline box with a dropdown */}
      <div ref={boxRef} className="relative hidden min-w-0 lg:block lg:w-[20rem] xl:w-[28rem]">
        <div className={cn('flex h-9 items-center rounded-md border bg-[var(--surface)] px-3 shadow-sm-soft transition-[border-color,box-shadow]', open ? 'border-[var(--brand-400)] shadow-[0_0_0_3px_var(--ring)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]')}>
          <Search className="mr-2 h-4 w-4 shrink-0 text-[var(--ink-4)]" aria-hidden="true" />
          <input ref={inputRef} {...inputProps} role="combobox" aria-controls={listId} aria-expanded={open && term.length >= 2} onFocus={() => setOpen(true)} className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] [&::-webkit-search-cancel-button]:hidden" />
          {waiting ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ink-4)]" aria-hidden="true" /> : <kbd className="hidden shrink-0 rounded border border-[var(--line)] px-1.5 text-[10px] font-semibold text-[var(--ink-4)] xl:inline">⌘K</kbd>}
        </div>
        {open && term.length >= 2 ? (
          <div className="mp-toast-enter absolute right-0 top-full z-50 mt-2 w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)] shadow-[var(--sh-pop)]">
            <div className="max-h-[70vh] overflow-y-auto p-1 custom-scrollbar">{results}</div>
          </div>
        ) : null}
      </div>

      {/* Phones and tablets: a button that opens a full-screen sheet */}
      <button type="button" onClick={() => setSheet(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-left text-sm text-[var(--ink-5)] shadow-sm-soft lg:hidden" aria-label="Search everything">
        <Search className="h-4 w-4 shrink-0 text-[var(--ink-4)]" aria-hidden="true" /><span className="truncate">Search customer, mobile, quote…</span>
      </button>
      {/* Portalled to <body>: the header's backdrop blur would otherwise trap a fixed sheet inside it. */}
      {sheet && typeof document !== 'undefined' ? createPortal(
        <div ref={sheetRef} className="mp-mobile-nav fixed inset-0 z-[90] flex flex-col bg-[var(--surface)] lg:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-md border border-[var(--brand-400)] px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 text-[var(--ink-4)]" aria-hidden="true" />
              <input ref={sheetInputRef} {...inputProps} role="combobox" aria-controls={listId} aria-expanded={term.length >= 2} className="w-full bg-transparent text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] [&::-webkit-search-cancel-button]:hidden" />
              {waiting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ink-4)]" aria-hidden="true" /> : null}
            </div>
            <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-md text-[var(--ink-3)] hover:bg-[var(--bg-soft)]" aria-label="Close search"><X className="h-5 w-5" aria-hidden="true" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">{results}</div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function Results({ listId, term, ready, waiting, groups, rows, active, onHover, onGo }: {
  listId: string; term: string; ready: boolean; waiting: boolean; groups: Group[]; rows: Row[]; active: number; onHover: (index: number) => void; onGo: (href: string) => void;
}) {
  if (!ready) return <p className="p-3 text-sm text-[var(--ink-4)]">Type at least 2 letters: a name, mobile number, quote or order number, SKU, vehicle number…</p>;
  if (!groups.length) return <p role="status" className="p-3 text-sm text-[var(--ink-4)]">{waiting ? 'Searching…' : `No matches for “${term}”.`}</p>;
  const indexOf = (id: string) => rows.findIndex((row) => row.id === id);
  return (
    <div id={listId} role="listbox" aria-label="Search results" className={cn('transition-opacity', waiting ? 'opacity-70' : '')}>
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label} className="py-1">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">{group.label}</p>
          {group.items.map((item) => {
            const rowId = `${group.key}-${item.kind}-${item.id}`;
            const index = indexOf(rowId);
            return (
              <button key={rowId} id={`${listId}-${rowId}`} type="button" role="option" aria-selected={index === active} onMouseEnter={() => onHover(index)} onClick={() => onGo(item.href)}
                className={cn('flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-2 text-left', index === active ? 'bg-[var(--bg-soft)]' : '')}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--ink)]">{item.title}</span>
                  {item.subtitle ? <span className="block truncate text-xs text-[var(--ink-4)]">{item.subtitle}</span> : null}
                </span>
                {item.meta ? <span className="shrink-0 pt-0.5 text-right text-xs text-[var(--ink-3)]">{item.meta}</span> : null}
              </button>
            );
          })}
          {group.moreHref ? (() => {
            const rowId = `${group.key}-more`;
            const index = indexOf(rowId);
            return (
              <button key={rowId} id={`${listId}-${rowId}`} type="button" role="option" aria-selected={index === active} onMouseEnter={() => onHover(index)} onClick={() => onGo(group.moreHref!)}
                className={cn('flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-700)]', index === active ? 'bg-[var(--bg-soft)]' : '')}>
                See all in {group.label}<ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>
            );
          })() : null}
        </div>
      ))}
    </div>
  );
}
