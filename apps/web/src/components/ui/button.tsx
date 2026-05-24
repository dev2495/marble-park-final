import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Buttons follow the v3 (subtle) treatment:
 *   - 6px radius, medium font weight, no all-caps tracking.
 *   - Solid blue for the primary CTA; everything else is a quiet neutral
 *     with a hover into the canvas-tint.
 *   - Shadow only at hover for primary; the rest stays flat.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--brand-600)] text-white shadow-[0_10px_22px_-16px_rgba(37,99,235,0.9)] hover:-translate-y-0.5 hover:bg-[var(--brand-700)] hover:shadow-md-soft",
        destructive: "bg-[var(--danger)] text-white hover:-translate-y-0.5 hover:brightness-95",
        outline: "border border-[var(--line)] bg-[var(--surface)]/80 text-[var(--ink-2)] shadow-sm-soft hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]",
        secondary: "bg-[var(--bg-soft)] text-[var(--ink)] hover:-translate-y-0.5 hover:bg-[var(--line-soft)]",
        ghost: "text-[var(--ink-2)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]",
        link: "text-[var(--brand-700)] underline-offset-4 hover:underline",
        success: "bg-[var(--success)] text-white hover:-translate-y-0.5 hover:brightness-95",
        warning: "bg-[var(--warning)] text-white hover:-translate-y-0.5 hover:brightness-95",
        dark: "bg-[var(--ink)] text-[var(--surface)] hover:-translate-y-0.5 hover:bg-[var(--ink-2)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5",
        xl: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
})
Button.displayName = "Button"

export { Button, buttonVariants }
