import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    className={cn("flex min-h-[80px] w-full rounded-2xl border border-[#d9cbbd]/18 bg-white/80 px-3 py-2 text-sm font-semibold text-[#241b14] transition-all placeholder:text-[#a89b90] focus:border-[#b17643]/45 focus:outline-none focus:ring-4 focus:ring-[#b17643]/10 disabled:cursor-not-allowed disabled:opacity-50", className)}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = "Textarea"

export { Textarea }
