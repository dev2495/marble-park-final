import * as React from "react"
import { Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps {
  /** A lucide icon component (Inbox) or any element. */
  icon?: LucideIcon | React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Usually a Button: "Add product", "Clear filters". */
  action?: React.ReactNode
  className?: string
  /** Smaller padding for use inside a card or table. */
  compact?: boolean
}

function isComponent(icon: unknown): icon is LucideIcon {
  return typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon && "render" in (icon as object))
}

/**
 *   <EmptyState icon={FileText} title="No quotes yet" description="Quotes you make show up here." action={<Button>New quote</Button>} />
 */
export function EmptyState({ icon, title, description, action, className, compact = false }: EmptyStateProps) {
  let iconNode: React.ReactNode
  if (icon === undefined) {
    iconNode = <Inbox className="h-5 w-5" aria-hidden="true" />
  } else if (isComponent(icon)) {
    const Icon = icon
    iconNode = <Icon className="h-5 w-5" aria-hidden="true" />
  } else {
    iconNode = icon as React.ReactNode
  }
  return (
    <div
      role="status"
      className={cn(
        "mp-empty flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <span className="mp-empty__icon" aria-hidden="true">{iconNode}</span>
      <div className="max-w-sm space-y-1">
        <p className="text-[15px] font-semibold text-[var(--ink)]">{title}</p>
        {description ? <p className="text-sm leading-relaxed text-[var(--ink-4)]">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export default EmptyState
