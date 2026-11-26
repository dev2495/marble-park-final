"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface PagerProps {
  /** 1-based page number. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
  /** Word for the rows, for the screen-reader label ("quotes", "products"). */
  itemLabel?: string
}

/**
 * Previous / next pager with "21-40 of 132".
 *
 *   <Pager page={page} pageSize={20} total={data.total} onPageChange={setPage} />
 */
export function Pager({ page, pageSize, total, onPageChange, className, itemLabel = "rows" }: PagerProps) {
  const safeSize = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / safeSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (current - 1) * safeSize + 1
  const to = Math.min(total, current * safeSize)
  const fmt = (n: number) => n.toLocaleString("en-IN")

  return (
    <nav aria-label="Pages" className={cn("mp-pager flex items-center justify-between gap-3 py-2", className)}>
      <p className="text-[13px] tabular-nums text-[var(--ink-4)]" aria-live="polite">
        {total === 0 ? (
          <>No {itemLabel}</>
        ) : (
          <>
            <span className="font-semibold text-[var(--ink-2)]">{fmt(from)}-{fmt(to)}</span> of {fmt(total)}
          </>
        )}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="min-w-[4.5rem] text-center text-[13px] tabular-nums text-[var(--ink-4)]">
          Page {current} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}

export default Pager
