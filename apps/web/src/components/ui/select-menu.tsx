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
      'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-[#e4e4e7] bg-white px-3 py-1.5 text-sm text-[#18181b] outline-none transition-colors',
      'focus:border-[#60a5fa] focus:ring-2 focus:ring-[rgba(37,99,235,0.35)]',
      'data-[placeholder]:text-[#a1a1aa] disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="truncate text-left">{children ?? <SelectPrimitive.Value placeholder={placeholder} />}</span>
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#71717a]" />
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
        'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[#e4e4e7] bg-white p-1 text-[#27272a] shadow-[0_12px_32px_-12px_rgba(24,24,27,0.18)]',
        'data-[state=open]:animate-fade-in data-[state=open]:animate-slide-in',
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
      'relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2.5 text-sm outline-none',
      'focus:bg-[#f4f4f5] focus:text-[#18181b] data-[highlighted]:bg-[#f4f4f5] data-[highlighted]:text-[#18181b]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-1.5 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-[#2563eb]" />
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
  <SelectPrimitive.Label ref={ref} className={cn('px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#71717a]', className)} {...props} />
));
SelectMenuLabel.displayName = 'SelectMenuLabel';

const SelectMenuSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('mx-1 my-1 h-px bg-[#e4e4e7]', className)} {...props} />
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
