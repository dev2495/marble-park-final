"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
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
  className,
  ariaLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
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
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
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
            "flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-left text-sm text-[var(--ink)] shadow-[0_1px_2px_rgba(30,20,18,.04)] outline-none transition",
            "hover:border-[#d7aaa0] hover:bg-[#fffaf8] focus-visible:border-[#a3312d] focus-visible:ring-2 focus-visible:ring-[#a3312d]/20 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-[var(--ink-4)]")}>
            {selected?.label || placeholder}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--ink-4)] transition", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[90] w-[var(--radix-popover-trigger-width)] min-w-[17rem] overflow-hidden rounded-xl border border-[#ead8d2] bg-white shadow-[0_24px_70px_-22px_rgba(64,31,27,.42)] animate-in fade-in zoom-in-95"
        >
          <div className="sticky top-0 border-b border-[#eee3df] bg-white p-2.5">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#8f817c]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) => Math.min(filtered.length - 1, index + 1));
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
                aria-controls="searchable-select-options"
                className="h-9 w-full rounded-lg border border-[#e6d8d3] bg-[#fffaf8] pl-9 pr-3 text-sm outline-none focus:border-[#a3312d] focus:ring-2 focus:ring-[#a3312d]/15"
              />
            </label>
          </div>
          <div id="searchable-select-options" role="listbox" className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                key={`${option.value}-${index}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition",
                  index === active ? "bg-[#fff0eb] text-[#6f211e]" : "hover:bg-[#fff7f4]",
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {option.value === value ? <Check className="h-4 w-4 text-[#a3312d]" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold">{option.label}</b>
                  {option.description ? (
                    <small className="mt-0.5 block truncate text-[11px] text-[#7c706c]">{option.description}</small>
                  ) : null}
                </span>
              </button>
            ))}
            {!filtered.length ? (
              <div className="px-4 py-8 text-center text-sm text-[#7c706c]">{emptyText}</div>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
