# Implementation Decisions Log

## Project Setup

### 2026-04-13 - Project Location
- **Decision**: Create new project structure at `marble_park/` due to corrupted `apps/` directory
- **Reason**: Original apps directory had corrupted filesystem entries preventing mkdir operations
- **Status**: ✅ Implemented

### 2026-04-13 - GraphQL API
- **Decision**: Use GraphQL with Apollo Server
- **Reason**: Flexible queries for dashboards, nested data for CRM, efficient data fetching
- **Status**: ✅ Decided

### 2026-04-13 - UI Framework
- **Decision**: Next.js 14 + shadcn/ui + Tailwind CSS
- **Reason**: Premium accessible UI, easy customization, component library matches sample quote aesthetic
- **Status**: ✅ Decided

### 2026-04-13 - Timeline
- **Decision**: 2-day aggressive timeline
- **Reason**: User requirement
- **Status**: ✅ Accepted

## Database

### 2026-04-13 - Existing Database
- **Decision**: Connect to existing PostgreSQL database
- **Details**: 
  - Host: localhost (via /tmp socket)
  - Database: marble_park
  - User: devarshthakkar
  - Tables: 21 (User, Product, Customer, Lead, Quote, InventoryBalance, etc.)
- **Status**: ✅ Connected and inspected

### 2026-04-13 - Schema Strategy
- **Decision**: Reconstruct Prisma schema from existing DB structure
- **Details**: Introspected tables with psql, will generate Prisma schema
- **Status**: ✅ Planned

## Features

### 2026-04-13 - Quote PDF Template
- **Decision**: Match sample quote layout exactly
- **Reference**: `sample qoute .pdf` - multi-page, branded header, line items table, totals section
- **Status**: ✅ Reference analyzed

### 2026-04-13 - Catalog Import Strategy
- **Decision**: 
  - Excel: openpyxl for parsing, dry-run validation, reversible imports
  - PDF: page extraction + image extraction as primary
  - AI: fallback only for low-confidence extractions
- **Status**: ✅ Planned

---
Last Updated: 2026-04-13