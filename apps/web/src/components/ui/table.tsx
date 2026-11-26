import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Table with the house style (kit.css .mp-table): sticky header, row hover,
 * tabular numbers, header cells with scope.
 *
 *   <Table label="Open quotes" zebra>
 *     <TableHeader><TableRow><TableHead>Quote</TableHead><TableHead numeric>Total</TableHead></TableRow></TableHeader>
 *     <TableBody>
 *       <TableRow><TableCell>Q-104</TableCell><TableCell numeric>₹ 42,000</TableCell></TableRow>
 *     </TableBody>
 *   </Table>
 *
 * label becomes the scroll region's accessible name. A clickable row should
 * be a link or button inside a cell, or pass onClick together with
 * tabIndex={0} and onKeyDown so the keyboard can open it too.
 */
export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  label?: string
  zebra?: boolean
  dense?: boolean
  /** Classes for the scrolling wrapper. */
  wrapperClassName?: string
  /** Max height of the scroll area; the header sticks while rows scroll. */
  maxHeight?: string
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, label, zebra, dense, wrapperClassName, maxHeight, children, ...props }, ref) => (
    <div
      className={cn("mp-table-wrap", wrapperClassName)}
      role={label ? "region" : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table ref={ref} className={cn("mp-table", zebra && "mp-table--zebra", dense && "mp-table--dense", className)} {...props}>
        {label ? <caption className="sr-only">{label}</caption> : null}
        {children}
      </table>
    </div>
  ),
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />,
)
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
)
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t border-[var(--line)] bg-[var(--surface-2)] font-semibold text-[var(--ink)]", className)} {...props} />
  ),
)
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }>(
  ({ className, selected, onClick, ...props }, ref) => (
    <tr
      ref={ref}
      className={className}
      data-selected={selected ? "" : undefined}
      data-clickable={onClick ? "" : undefined}
      aria-selected={selected || undefined}
      onClick={onClick}
      {...props}
    />
  ),
)
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(
  ({ className, scope = "col", numeric, ...props }, ref) => (
    <th ref={ref} scope={scope} className={cn(numeric && "mp-num", className)} {...props} />
  ),
)
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(
  ({ className, numeric, ...props }, ref) => <td ref={ref} className={cn(numeric && "mp-num", className)} {...props} />,
)
TableCell.displayName = "TableCell"

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell }
