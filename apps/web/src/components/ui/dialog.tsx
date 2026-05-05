import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => onOpenChange?.(false)}
          />
          <div className="relative z-50 w-full max-w-lg p-6">
            {children}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}

const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div className={cn("bg-white rounded-xl shadow-xl p-6", className)} {...props}>
    {children}
  </div>
)

const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn("mb-4", className)} {...props} />
)

const DialogTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ className, ...props }) => (
  <h2 className={cn("text-xl font-semibold text-slate-800", className)} {...props} />
)

const DialogDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, ...props }) => (
  <p className={cn("text-sm text-slate-500 mt-1", className)} {...props} />
)

const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn("flex justify-end gap-3 mt-6", className)} {...props} />
)

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
