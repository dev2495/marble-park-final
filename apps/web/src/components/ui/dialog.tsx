"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFocusTrap } from "@/hooks/use-focus-trap"

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  /** Clicking the dimmed page closes the dialog (default true). Turn off for forms that must not be lost. */
  dismissOnOverlay?: boolean
  /** Escape closes the dialog (default true). */
  dismissOnEscape?: boolean
  /** Use "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog"
}

type DialogCtx = { titleId: string; descriptionId: string; close: () => void }
const DialogContext = React.createContext<DialogCtx | null>(null)

/**
 * Modal dialog. Keeps focus inside while open, focuses the first field (or an
 * element marked data-autofocus), closes on Escape and on the dimmed page,
 * and gives focus back to the button that opened it.
 *
 * DialogTitle and DialogDescription are wired to aria-labelledby /
 * aria-describedby automatically.
 */
const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  children,
  dismissOnOverlay = true,
  dismissOnEscape = true,
  role = "dialog",
}) => {
  const [mounted, setMounted] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-desc`
  const close = React.useCallback(() => onOpenChange?.(false), [onOpenChange])

  React.useEffect(() => {
    setMounted(true)
  }, [])

  useFocusTrap(panelRef, Boolean(open && mounted), {
    onEscape: dismissOnEscape ? close : undefined,
  })

  const [hasDescription, setHasDescription] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!open) return
    setHasDescription(Boolean(panelRef.current?.querySelector(`[id="${descriptionId}"]`)))
  }, [open, descriptionId, children])

  if (!mounted) return null

  return createPortal(
    <>
      {open && (
        <DialogContext.Provider value={{ titleId, descriptionId, close }}>
          <div className="mp-dialog-root fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <div
              aria-hidden="true"
              className="mp-overlay fixed inset-0 bg-[rgba(15,16,22,0.48)] backdrop-blur-[2px]"
              onClick={dismissOnOverlay ? close : undefined}
            />
            <div
              ref={panelRef}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={hasDescription ? descriptionId : undefined}
              tabIndex={-1}
              className="relative z-50 flex max-h-[100dvh] w-full justify-center overflow-y-auto p-3 outline-none sm:p-6"
              onClick={(e) => {
                if (dismissOnOverlay && e.target === e.currentTarget) close()
              }}
            >
              {children}
            </div>
          </div>
        </DialogContext.Provider>
      )}
    </>,
    document.body
  )
}

const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement> & { showClose?: boolean }> = ({ className, children, showClose = false, ...props }) => {
  const ctx = React.useContext(DialogContext)
  return (
    <div
      className={cn(
        "mp-dialog-panel relative w-full max-w-lg rounded-r6 border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink-2)] shadow-[var(--sh-xl)] sm:p-6",
        className,
      )}
      {...props}
    >
      {showClose && ctx && (
        <button
          type="button"
          onClick={ctx.close}
          aria-label="Close"
          className="mp-icon-btn absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink-4)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {children}
    </div>
  )
}

const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn("mb-4 space-y-1 pr-8", className)} {...props} />
)

const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, id, ...props }) => {
  const ctx = React.useContext(DialogContext)
  return <h2 id={id ?? ctx?.titleId} className={cn("text-lg font-semibold leading-snug tracking-[-0.01em] text-[var(--ink)]", className)} {...props} />
}

const DialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, id, ...props }) => {
  const ctx = React.useContext(DialogContext)
  return <p id={id ?? ctx?.descriptionId} className={cn("text-sm leading-relaxed text-[var(--ink-4)]", className)} {...props} />
}

const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3", className)} {...props} />
)

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
