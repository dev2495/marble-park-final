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
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(37,99,235,0.35)] focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#2563eb] text-white hover:bg-[#1d4ed8]",
        destructive: "bg-[#dc2626] text-white hover:bg-red-700",
        outline: "border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#f4f4f5] hover:text-[#18181b]",
        secondary: "bg-[#f4f4f5] text-[#18181b] hover:bg-[#e4e4e7]",
        ghost: "text-[#27272a] hover:bg-[#f4f4f5] hover:text-[#18181b]",
        link: "text-[#1d4ed8] underline-offset-4 hover:underline",
        success: "bg-[#059669] text-white hover:bg-emerald-700",
        warning: "bg-[#d97706] text-white hover:bg-amber-700",
        dark: "bg-[#18181b] text-white hover:bg-[#27272a]",
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
