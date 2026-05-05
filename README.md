# Marble Park - Premium Bath Solutions Platform

A full-stack retail operations platform for Marble Park, built with Next.js, NestJS GraphQL API, and PostgreSQL.

## Quick Start

```bash
# Install dependencies
npm install
cd apps/api && npm install
cd ../web && npm install
cd ../..

# Generate Prisma client
cd apps/api && npx prisma generate

# Start services
npm run dev
```

## Project Structure

```
marble_park/
├── apps/
│   ├── api/           # NestJS GraphQL API
│   │   ├── prisma/   # Database schema
│   │   └── src/
│   │       └── modules/
│   │           ├── auth/        # Login, session
│   │           ├── users/      # User management
│   │           ├── customers/  # CRM
│   │           ├── leads/      # Lead management
│   │           ├── quotes/     # Quote generation
│   │           ├── products/   # Product catalog
│   │           ├── inventory/  # Stock management
│   │           ├── dispatch/   # Delivery
│   │           ├── dashboards/ # Analytics
│   │           ├── documents/ # PDF/Email
│   │           └── imports/   # Excel import
│   └── web/           # Next.js 14 Frontend
│       └── src/
│           ├── app/        # App router pages
│           └── components/  # UI components
├── package.json       # Monorepo root
└── IMPLEMENTATION_CHECKLIST.md
```

## Tech Stack

- **Frontend**: Next.js 14, Tailwind CSS, shadcn/ui, Apollo Client
- **Backend**: NestJS, GraphQL, Prisma ORM
- **Database**: PostgreSQL (existing)
- **Auth**: JWT + Session

## Features

- User authentication with 5 roles
- Customer/Lead management
- Quote generation with versioning
- Inventory tracking
- Dispatch management
- Excel import
- Sales dashboards

## Status

🔄 Implementation in progress - see IMPLEMENTATION_CHECKLIST.md

## Database

Connected to existing PostgreSQL database at:
- Host: localhost (via sock)
- Database: marble_park
- Tables: 21 (User, Customer, Lead, Quote, Product, etc.)
- Records: 7 users, 1723 products

## Data Files

Located in `../data folder n sample/`:
- Catalogs: 6 PDF files (~180MB)
- Price Lists: 4 Excel files
- Sample Quote: `sample qoute .pdf`

---
Built 2026-04-13 | Marble Park Recovery