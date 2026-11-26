'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Premium select dropdown — Radix primitives styled to match the v3 theme.
 *
 * Use this instead of <select><option>...</option></select> wherever you want
 * a polished, consistent UI. Same value/onChange contract, just slightly
 * different JSX:
 *
 *   <SelectMenu value={mode} onValueChange={setMode}>
 *     <SelectMenu.Trigger className="…" />
 *     <SelectMenu.Item value="priced">Show prices</SelectMenu.Item>
 *     <SelectMenu.Item value="selection">Hide prices</SelectMenu.Item>
 *   </SelectMenu>
 */

const SelectMenuRoot = SelectPrimitive.Root;
const SelectMenuGroup = SelectPrimitive.Group;
const SelectMenuValue = SelectPrimitive.Value;

const SelectMenuTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { placeholder?: string }
>(({ className, children, placeholder, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'mp-control flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] shadow-sm-soft outline-none transition-[border-color,box-shadow] duration-150',
      'focus:border-[var(--brand-500)] focus:ring-[3px] focus:ring-[var(--ring)] data-[state=open]:border-[var(--brand-500)] data-[state=open]:ring-[3px] data-[state=open]:ring-[var(--ring)]',
      'data-[placeholder]:text-[var(--ink-5)] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:opacity-60 [&[data-state=open]>svg]:rotate-180',
      className,
    )}
    {...props}
  >
    <span className="truncate text-left">{children ?? <SelectPrimitive.Value placeholder={placeholder} />}</span>
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ink-4)] transition-transform duration-200" aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectMenuTrigger.displayName = 'SelectMenuTrigger';

const SelectMenuContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        'mp-pop z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 text-[var(--ink-2)] shadow-[var(--sh-pop)]',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-[18rem]">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectMenuContent.displayName = 'SelectMenuContent';

const SelectMenuItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2.5 text-sm outline-none transition-colors',
      'focus:bg-[var(--bg-soft)] focus:text-[var(--ink)] data-[highlighted]:bg-[var(--bg-soft)] data-[highlighted]:text-[var(--ink)] data-[state=checked]:font-medium data-[state=checked]:text-[var(--ink)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-1.5 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-[var(--brand-600)]" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectMenuItem.displayName = 'SelectMenuItem';

const SelectMenuLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn('px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]', className)} {...props} />
));
SelectMenuLabel.displayName = 'SelectMenuLabel';

const SelectMenuSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('mx-1 my-1 h-px bg-[var(--line)]', className)} {...props} />
));
SelectMenuSeparator.displayName = 'SelectMenuSeparator';

export {
  SelectMenuRoot as SelectMenu,
  SelectMenuGroup,
  SelectMenuValue,
  SelectMenuTrigger,
  SelectMenuContent,
  SelectMenuItem,
  SelectMenuLabel,
  SelectMenuSeparator,
};
