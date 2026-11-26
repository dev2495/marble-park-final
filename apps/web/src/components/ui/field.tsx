"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface FieldProps {
  label: React.ReactNode
  /** id of the control. If left out an id is made and given to the single child control. */
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Label + control + hint + error, wired for screen readers.
 *
 *   <Field label="Customer phone" htmlFor="phone" hint="10 digits" error={errors.phone} required>
 *     <Input id="phone" value={phone} onChange={...} />
 *   </Field>
 *
 * When the child is a single element, Field adds id (if missing),
 * aria-describedby (hint and error), aria-invalid and aria-required to it.
 */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const autoId = React.useId()
  const child = React.Children.count(children) === 1 && React.isValidElement(children) ? (children as React.ReactElement<Record<string, unknown>>) : null
  const childId = child ? (child.props.id as string | undefined) : undefined
  const controlId = htmlFor ?? childId ?? `${autoId}-control`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  let control: React.ReactNode = children
  if (child) {
    const existing = child.props["aria-describedby"] as string | undefined
    control = React.cloneElement(child, {
      id: childId ?? controlId,
      "aria-describedby": [existing, describedBy].filter(Boolean).join(" ") || undefined,
      "aria-invalid": error ? true : (child.props["aria-invalid"] as boolean | undefined),
      "aria-required": required ? true : (child.props["aria-required"] as boolean | undefined),
    })
  }

  return (
    <div className={cn("mp-field space-y-1.5", className)} data-invalid={error ? "" : undefined}>
      <label htmlFor={controlId} className="mp-field-label">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-[var(--danger-fg)]">*</span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-[13px] leading-snug text-[var(--ink-4)]">
          {hint}
        </p>
      ) : hint ? (
        <span id={hintId} className="sr-only">{hint}</span>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1 text-[13px] font-medium leading-snug text-[var(--danger-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default Field
