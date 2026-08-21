# Quote retail pricing ladder

## Authoritative calculation

For each billed unit, Marble Park calculates in this fixed order:

1. **MRP** is a tax-inclusive amount entered for the selected rate basis: box, piece, or area.
2. **NRP/base discount** is entered as a percentage or rupee amount and is applied to MRP. Percentage is the default.
3. **NRP** equals MRP less the base discount.
4. **Special discount** is optional, accepts percentage or rupee amount, and is applied to NRP. Percentage is the default.
5. **Net selling price** equals NRP less the special discount.
6. **Additional quote discount** is optional, accepts percentage or rupee amount, and is applied after every line is priced. It is allocated proportionally across lines for a stable tax and order-conversion snapshot.
7. Taxable value and GST are derived from the final tax-inclusive line value. The rounded line values reconcile to the saved quote total.

The read-only **Product Master MRP reference** is shown beside the quote decision. The operator can confirm the quote's MRP snapshot without changing the Product Master record.

## Worked example

MRP ₹1,180, NRP discount 10%, and special discount 5% produce NRP ₹1,062 and net selling price ₹1,008.90. A further 2% whole-quote discount is ₹20.18, leaving ₹988.72 tax-inclusive: ₹837.90 taxable value plus ₹150.82 GST at 18%.

## Operator controls

- `/` focuses product search.
- `Cmd/Ctrl+S` saves a draft even when commercial readiness is incomplete.
- `Cmd/Ctrl+Enter` validates the quote when required pricing is complete.
- `Esc` closes the scan panel.
- `Tab` follows the natural field order; the application does not override browser keyboard navigation.

## Guardrails and audit

- MRP must be positive and cannot be below the final tax-inclusive payable.
- A percent discount must be from 0 to 100.
- A rupee NRP discount cannot exceed MRP; a rupee special discount cannot exceed NRP.
- The whole-quote discount cannot exceed the sum of line net values.
- Quotes are validated against MRP, NRP and special-discount rules; no hidden legacy floor-price gate is used.
- A commercial revision keeps the prior quote and lineage; confirmed/ordered pricing is not overwritten.
- Quote Register value, quotation PDF and Sales Order conversion use the same saved commercial snapshot.
