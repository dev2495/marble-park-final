import * as React from "react"
import { cn } from "@/lib/utils"

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    className={cn("flex h-10 w-full rounded-2xl border border-[#7a5b3c]/18 bg-white/80 px-3 py-2 text-sm font-semibold text-[#211b16] transition-all focus:border-[#b57942]/45 focus:outline-none focus:ring-4 focus:ring-[#b57942]/10 disabled:cursor-not-allowed disabled:opacity-50", className)}
    ref={ref}
    {...props}
  />
))
Select.displayName = "Select"

export { Select }
