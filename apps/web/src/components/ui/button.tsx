import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-sm font-black tracking-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#211b16] text-[#fffaf3] shadow-xl shadow-[#211b16]/15 hover:-translate-y-0.5 hover:bg-[#33291f]",
        destructive: "bg-red-700 text-white shadow-red-900/20 hover:bg-red-800",
        outline: "border border-[#7a5b3c]/18 bg-white/70 text-[#211b16] shadow-sm hover:bg-white hover:border-[#b57942]/40",
        secondary: "bg-[#ead7c0] text-[#211b16] hover:bg-[#dfc4a4]",
        ghost: "text-[#5f4b3b] hover:bg-[#ead7c0]/60 hover:text-[#211b16]",
        link: "text-[#9a6434] underline-offset-4 hover:underline",
        success: "bg-[#24544d] text-white shadow-[#24544d]/20 hover:bg-[#1d463f]",
        warning: "bg-[#b57942] text-white shadow-[#b57942]/20 hover:bg-[#9f6638]",
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
