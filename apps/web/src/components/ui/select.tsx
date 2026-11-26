import * as React from "react"
import { cn } from "@/lib/utils"

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    className={cn("mp-control mp-select-chevron flex h-9 w-full cursor-pointer appearance-none rounded-md border border-[var(--input-border)] bg-[var(--surface)] py-1.5 pl-3 pr-9 text-sm text-[var(--ink)] shadow-sm-soft transition-[border-color,box-shadow] duration-150 focus:border-[var(--brand-500)] focus:outline-none focus:ring-[3px] focus:ring-[var(--ring)] aria-[invalid=true]:border-[var(--danger-border)] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:opacity-60", className)}
    ref={ref}
    {...props}
  />
))
Select.displayName = "Select"

export { Select }
