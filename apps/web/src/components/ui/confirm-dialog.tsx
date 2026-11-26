"use client"

import * as React from "react"
import { AlertTriangle, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: "default" | "danger"
  /** While true the buttons are disabled, the confirm button shows a spinner and the dialog cannot be closed. */
  busy?: boolean
  /** Called on confirm. Close the dialog yourself when the work succeeds (onOpenChange(false)). */
  onConfirm: () => void | Promise<unknown>
  /** Extra fields (for example a reason box) shown between the text and the buttons. */
  children?: React.ReactNode
  /** Disable the confirm button, for example until a required reason is typed. */
  confirmDisabled?: boolean
}

/**
 * Ask before doing something that cannot easily be undone.
 *
 *   <ConfirmDialog
 *     open={open} onOpenChange={setOpen}
 *     title="Cancel this order?"
 *     description="Reserved stock goes back to the shelf."
 *     confirmLabel="Cancel order" tone="danger"
 *     busy={busy.isBusy('cancel')}
 *     onConfirm={() => busy.run('cancel', async () => { await cancel(); setOpen(false) })}
 *   >
 *     <Field label="Reason" htmlFor="reason" required><Textarea id="reason" ... /></Field>
 *   </ConfirmDialog>
 *
 * Focus starts on Cancel for danger confirmations, so Enter never deletes by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  children,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const danger = tone === "danger"
  const handleOpenChange = (next: boolean) => {
    if (busy && !next) return
    onOpenChange(next)
  }
  const Icon = danger ? AlertTriangle : HelpCircle

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} role="alertdialog" dismissOnOverlay={!busy}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (busy || confirmDisabled) return
            void onConfirm()
          }}
        >
          <DialogHeader className="flex flex-row items-start gap-3 space-y-0 pr-0">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                danger ? "bg-[var(--danger-bg)] text-[var(--danger-fg)]" : "bg-[var(--info-bg)] text-[var(--info-fg)]",
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
          </DialogHeader>
          {children ? <div className="mt-4 space-y-3">{children}</div> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy} data-autofocus={danger ? "" : undefined}>
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={danger ? "destructive" : "default"}
              loading={busy}
              disabled={confirmDisabled}
              data-autofocus={danger ? undefined : ""}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialog
