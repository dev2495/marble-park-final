# Marble Park Retail ERP Feature Research Map

Date: 2026-04-29

This is the working feature map for a sanitaryware, faucet, sink, tile and project-retail inventory CRM system. It separates what the app now has from the next modules needed for a complete commercial ERP.

## Core Roles

- Admin: users, role switch, full data access, imports, settings.
- Owner: dashboards, sales performance, quote value, margin, dispatch pressure, ageing.
- Sales manager: team pipeline, lead assignment, quote approval, follow-up control.
- Sales user: own leads, customers, catalogue, quote builder, quote register, follow-ups.
- Inventory manager: product master, inwards, stock correction, reservations, zero-stock catalogue.
- Dispatch ops: confirmed quote queue, packing, challan, delivery status.

## Required Page Map

- Command dashboard: role-aware landing and KPIs.
- Sales desk: daily follow-up queue, personal leads, recent quotes, quick create lead/quote.
- CRM pipeline: kanban by lead stage.
- New lead: customer, source, expected value, next action, notes.
- Customers: customer master and project/site details.
- Catalogue: image-backed product browsing, category/brand/price search.
- Quote register: list, filter, send, confirm, PDF download.
- Quote builder: customer + image-backed SKU lines + GST totals.
- Quote detail: line item image preview, customer, totals, PDF, send, confirm-to-dispatch.
- Inventory: stock balances, available/reserved/damaged/hold.
- Inwards: supplier batch and stock addition flow.
- Dispatch: pending jobs and status movement.
- Users: create/disable users and role management.

## Important Business Logic

- Catalogue products can exist with zero stock; sales must still browse and quote them.
- Confirmed quotes should create dispatch jobs exactly once.
- Quote ownership must come from logged-in session for sales users.
- Admin/owner can manage users; sales users cannot.
- Quote PDFs must use the same product image stored in line media.
- Lead flow must lead naturally into quote flow; quote creation auto-creates an opportunity when needed.
- Owner dashboard must show user-wise performance, quote value, conversion, image coverage and dispatch pressure.

## Implemented In Current Pass

- Quote register route: `/dashboard/quotes`.
- Quote builder route: `/dashboard/quotes/new`.
- Quote detail route: `/dashboard/quotes/[id]`.
- Sales desk route: `/dashboard/sales`.
- New lead route: `/dashboard/leads/new`.
- Quote PDF endpoint: `/api/pdf/quote/[id]` using real quote data and line images.
- Send quote and confirm quote actions from quote list/detail.
- Confirm quote creates dispatch job through existing backend service.
- Lead stage movement from sales desk.

## Next ERP Modules Still Recommended

- Quote approval rules for high discounts and owner approval inbox.
- Customer detail page with all leads, quotes, dispatches, site contacts and notes.
- Product detail page with stock, pricing, image/source provenance and alternatives.
- Import review queue for PDF/Excel extraction confidence and manual SKU-image mapping.
- Purchase order/vendor ordering for out-of-stock quoted products.
- Reservation logic when quote is sent/confirmed.
- Dispatch challan printable PDF with packing proof and delivery proof upload.
- Payment collection and outstanding receivables.
- GST/tax invoice flow separate from quotation.
- Audit log and activity timeline per lead/quote/customer.
- Notification center for due follow-ups and approval/dispatch events.
