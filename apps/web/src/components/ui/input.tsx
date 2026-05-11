import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-9 w-full rounded-md border border-[#e4e4e7] bg-white px-3 py-1.5 text-sm text-[#18181b] transition-colors placeholder:text-[#a1a1aa] focus:border-[#60a5fa] focus:outline-none focus:ring-2 focus:ring-[rgba(37,99,235,0.35)] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = "Input"

export { Input }
