import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Slightly less aggressive font weight (was font-black tracking-tight) so
  // the showroom UI doesn't feel shouty. Letter-spacing relaxed for Inter.
  "inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Primary CTA = brand-600 → brand-700 hover. Glow shadow at rest.
        default: "bg-[var(--brand-600)] text-white shadow-md-soft hover:-translate-y-0.5 hover:bg-[var(--brand-700)] hover:shadow-glow-brand",
        destructive: "bg-[var(--rose-500)] text-white shadow-sm-soft hover:bg-[var(--rose-700)]",
        outline: "border border-[var(--b)] bg-white text-[var(--t2)] shadow-flat hover:bg-[var(--brand-50)] hover:border-[var(--brand-400)] hover:text-[var(--brand-700)]",
        secondary: "bg-[var(--brand-50)] text-[var(--brand-800)] border border-[var(--brand-100)] hover:bg-[var(--brand-100)]",
        ghost: "text-[var(--t2)] hover:bg-[var(--canvas-tint)] hover:text-[var(--t1)]",
        link: "text-[var(--link)] underline-offset-4 hover:underline",
        success: "bg-[var(--emerald-500)] text-white shadow-glow-emerald hover:bg-[var(--emerald-700)]",
        warning: "bg-[var(--amber-500)] text-white shadow-sm-soft hover:bg-[var(--amber-700)]",
        dark: "bg-[var(--brand-950)] text-white hover:bg-[var(--brand-900)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-8 text-base",
        icon: "h-10 w-10",
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
