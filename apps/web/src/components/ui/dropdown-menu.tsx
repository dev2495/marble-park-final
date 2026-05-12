'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Premium dropdown menu — Radix primitives, v3 theme. Free
 * click-outside-to-close, ESC handling, keyboard navigation and focus
 * management. Used by the topbar profile menu, notifications, custom
 * Select component, role switcher.
 */

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[12rem] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1.5 text-[var(--ink-2)] shadow-[0_12px_32px_-12px_rgba(24,24,27,0.18)]',
        'data-[state=open]:animate-fade-in data-[state=open]:animate-slide-in',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; danger?: boolean }
>(({ className, inset, danger, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors',
      'focus:bg-[var(--bg-soft)] focus:text-[var(--ink)] data-[highlighted]:bg-[var(--bg-soft)] data-[highlighted]:text-[var(--ink)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      danger ? 'text-[var(--danger)] focus:bg-[var(--danger-bg)] focus:text-[var(--danger)] data-[highlighted]:bg-[var(--danger-bg)] data-[highlighted]:text-[var(--danger)]' : 'text-[var(--ink-2)]',
      inset ? 'pl-8' : '',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-[var(--line)]', className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2.5 text-sm outline-none transition-colors',
      'focus:bg-[var(--bg-soft)] focus:text-[var(--ink)] data-[highlighted]:bg-[var(--bg-soft)]',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current text-[var(--brand-600)]" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto text-[10px] font-medium tracking-widest text-[var(--ink-5)]', className)} {...props} />
);
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
};
