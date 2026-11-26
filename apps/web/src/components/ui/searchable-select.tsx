"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2 as LoaderCircle, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
  disabled?: boolean;
};

type Props = {
  value?: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  onSearchChange?: (value: string) => void;
  className?: string;
  ariaLabel?: string;
};

export function SearchableSelect({
  value = "",
  onValueChange,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Type to search…",
  emptyText = "No matching options",
  disabled,
  loading = false,
  onSearchChange,
  className,
  ariaLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = `${React.useId()}-options`;
  const selected = options.find((option) => option.value === value);
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.label, option.description, option.keywords]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [options, query]);

  React.useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      0,
      filtered.findIndex((option) => option.value === value),
    );
    setActive(selectedIndex);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(option: SearchableSelectOption | undefined) {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    setQuery("");
    onSearchChange?.("");
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          onSearchChange?.("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "mp-control flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--surface)] px-3 text-left text-sm text-[var(--ink)] shadow-sm-soft outline-none transition-[border-color,box-shadow,background-color] duration-150",
            "hover:bg-[var(--surface-2)] focus-visible:border-[var(--brand-500)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:opacity-60",
            open && "border-[var(--brand-500)] ring-[3px] ring-[var(--ring)]",
            className,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-[var(--ink-5)]")}>
            {selected?.label || placeholder}
          </span>
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-[var(--ink-4)] transition-transform duration-200", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="mp-pop z-[90] w-[var(--radix-popover-trigger-width)] min-w-[17rem] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--sh-pop)]"
        >
          <div className="sticky top-0 border-b border-[var(--line)] bg-[var(--surface)] p-2.5">
            <label className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-4)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  onSearchChange?.(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(Math.max(0, filtered.length - 1), index + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(0, index - 1));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    choose(filtered[active]);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    setActive(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    setActive(Math.max(0, filtered.length - 1));
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
                className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--surface-2)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] focus:border-[var(--brand-500)] focus:ring-[3px] focus:ring-[var(--ring)]"
              />
            </label>
          </div>
          <div id={listId} role="listbox" aria-label={ariaLabel || placeholder} aria-busy={loading} className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
            {loading ? (
              <div role="status" className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-[var(--ink-4)]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Searching the full registry…
              </div>
            ) : null}
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                id={`${listId}-${index}`}
                key={`${option.value}-${index}`}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors",
                  index === active ? "bg-[var(--brand-50)] text-[var(--brand-800)] dark:text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--bg-soft)]",
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {option.value === value ? <Check aria-hidden="true" className="h-4 w-4 text-[var(--brand-600)]" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold">{option.label}</b>
                  {option.description ? (
                    <small className="mt-0.5 block truncate text-xs text-[var(--ink-4)]">{option.description}</small>
                  ) : null}
                </span>
              </button>
            ))}
            {!loading && !filtered.length ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink-4)]">{emptyText}</div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
