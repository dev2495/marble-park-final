import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    className={cn("mp-control flex min-h-[80px] w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed text-[var(--ink)] shadow-sm-soft transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--ink-5)] focus:border-[var(--brand-500)] focus:outline-none focus:ring-[3px] focus:ring-[var(--ring)] aria-[invalid=true]:border-[var(--danger-border)] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:opacity-60", className)}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = "Textarea"

export { Textarea }
