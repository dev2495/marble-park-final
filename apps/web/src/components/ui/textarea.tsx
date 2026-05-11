import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    className={cn("flex min-h-[80px] w-full rounded-2xl border border-[#cbd5e1]/18 bg-white/80 px-3 py-2 text-sm font-semibold text-[#0e1a3d] transition-all placeholder:text-[#94a3b8] focus:border-[#2563eb]/45 focus:outline-none focus:ring-4 focus:ring-[#2563eb]/10 disabled:cursor-not-allowed disabled:opacity-50", className)}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = "Textarea"

export { Textarea }
