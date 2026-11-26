import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "mp-control flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)] shadow-sm-soft transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--ink-5)] file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--ink-2)] focus:border-[var(--brand-500)] focus:outline-none focus:ring-[3px] focus:ring-[var(--ring)] aria-[invalid=true]:border-[var(--danger-border)] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:opacity-60 read-only:bg-[var(--surface-2)]",
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = "Input"

export { Input }
