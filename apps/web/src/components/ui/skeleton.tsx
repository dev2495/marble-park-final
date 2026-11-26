import * as React from "react"
import { cn } from "@/lib/utils"

/** Grey shimmering placeholder while data loads. Size it with className (h-4 w-32). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("mp-skeleton h-4 w-full rounded-md", className)} {...props} />
}

export interface TableSkeletonProps {
  rows?: number
  cols?: number
  className?: string
  /** Screen-reader text. */
  label?: string
}

/** Placeholder rows for a table that is loading. */
export function TableSkeleton({ rows = 6, cols = 5, className, label = "Loading" }: TableSkeletonProps) {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-1/3", "w-3/5"]
  return (
    <div role="status" aria-live="polite" className={cn("mp-table-skeleton w-full overflow-hidden rounded-r5 border border-[var(--line)] bg-[var(--surface)]", className)}>
      <span className="sr-only">{label}</span>
      <div className="grid gap-4 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="h-3 w-1/2" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-[var(--line-soft)] px-4 py-3.5 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", widths[(r + c) % widths.length])} />
          ))}
        </div>
      ))}
    </div>
  )
}

export default Skeleton
