import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Buttons follow the v3 (subtle) treatment:
 *   - 6px radius, medium font weight, no all-caps tracking.
 *   - Solid brand red for the primary action; everything else is a quiet
 *     neutral with a hover into the canvas tint.
 *   - Lift on hover (none when the system asks for reduced motion), settle on press.
 *   - Status fills use the -solid tokens: white text is 5.4:1 or better in both themes.
 *   - loading: spinner + disabled + aria-busy, label stays so the width holds.
 *   - Touch screens get 44px targets for default, sm, lg and icon.
 */
const buttonVariants = cva(
  "mp-btn inline-flex select-none items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 [transition-timing-function:var(--eo)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)] active:translate-y-0 active:duration-75 disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--brand-600)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_22px_-16px_rgba(127,33,29,0.9)] hover:-translate-y-0.5 hover:bg-[var(--brand-700)] hover:shadow-md-soft active:bg-[var(--brand-800)] dark:hover:bg-[#a83a33] dark:active:bg-[#9d2a24]",
        destructive: "bg-[var(--danger-solid)] text-[var(--on-solid)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:-translate-y-0.5 hover:brightness-110",
        outline: "border border-[var(--line-strong)] bg-[var(--surface)]/80 text-[var(--ink-2)] shadow-sm-soft hover:-translate-y-0.5 hover:border-[var(--input-border)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] active:bg-[var(--line-soft)]",
        secondary: "bg-[var(--bg-soft)] text-[var(--ink)] hover:-translate-y-0.5 hover:bg-[var(--line-soft)] active:bg-[var(--line)]",
        ghost: "text-[var(--ink-2)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] active:bg-[var(--line-soft)]",
        link: "text-[var(--brand-700)] underline-offset-4 hover:underline",
        success: "bg-[var(--success-solid)] text-[var(--on-solid)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:-translate-y-0.5 hover:brightness-110",
        warning: "bg-[var(--warning-solid)] text-[var(--on-solid)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:-translate-y-0.5 hover:brightness-110",
        dark: "bg-[var(--ink)] text-[var(--surface)] hover:-translate-y-0.5 hover:bg-[var(--ink-2)]",
      },
      // Desktop sizes stay compact; on touch screens (pointer: coarse) default,
      // sm and icon grow to a 44px target (kit.css .mp-tap / .mp-tap-icon).
      size: {
        default: "mp-tap h-9 px-4",
        sm: "mp-tap h-8 px-3 text-[13px]",
        lg: "mp-tap h-10 px-5",
        xl: "h-11 px-6 text-base",
        icon: "mp-tap-icon h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows a spinner, disables the button and sets aria-busy. The label stays so the width does not jump. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, loading = false, disabled, children, type, ...props }, ref) => {
  if (asChild) {
    return <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} aria-busy={loading || undefined} {...props}>{children}</Slot>
  }
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }), loading && "relative cursor-progress")}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading && (
        <span className="mp-spinner" aria-hidden="true" />
      )}
      {children}
    </button>
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
