import * as React from "react"
import { cn } from "@/lib/utils"

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone
  /** Show the small coloured dot before the text (default true). */
  dot?: boolean
}

/**
 * Small status label with a calm tinted background. Colours come from the
 * status tokens, so they read in light and dark mode (4.5:1 or better).
 *
 *   <StatusPill tone="success">Paid</StatusPill>
 *   <StatusPill tone="warning">Part paid</StatusPill>
 */
export function StatusPill({ tone, dot = true, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn("mp-pill", `mp-pill--${tone}`, className)} {...props}>
      {dot ? <span className="mp-pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export default StatusPill
