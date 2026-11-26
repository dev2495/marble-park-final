import * as React from "react"
import { cn } from "@/lib/utils"

export interface PageHeaderProps {
  title: React.ReactNode
  /** Small label above the title, for the area ("Sales", "Stock"). */
  eyebrow?: React.ReactNode
  description?: React.ReactNode
  /** Buttons on the right; they wrap under the title on phones. */
  actions?: React.ReactNode
  className?: string
}

/**
 * The page's single <h1> with its actions.
 *   <PageHeader eyebrow="Sales" title="Quotes" description="Every quote, newest first." actions={<Button>New quote</Button>} />
 */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mp-page-header", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mp-eyebrow">{eyebrow}</p> : null}
        <h1 className="mp-page-title">{title}</h1>
        {description ? <p className="mp-page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="mp-page-actions">{actions}</div> : null}
    </header>
  )
}

export default PageHeader
