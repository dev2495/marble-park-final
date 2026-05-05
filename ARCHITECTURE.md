# Architecture Decisions

## Framework & Stack Decisions

### Backend
- **Runtime**: Node.js 20 LTS
- **API Style**: GraphQL (Apollo Server) - flexible for complex queries, dashboards
- **Framework**: NestJS - structured, modular, TypeScript-first
- **Database ORM**: Prisma - type-safe, works with existing Postgres
- **Authentication**: JWT + Session hybrid (JWT for API, Session for web)
- **Email**: Nodemailer with SMTP

### Frontend
- **Framework**: Next.js 14 (App Router)
- **UI Library**: shadcn/ui + Tailwind CSS - clean, accessible, customizable
- **State**: React Query (TanStack Query) - server state management
- **Forms**: React Hook Form + Zod validation
- **PDF Generation**: @react-pdf/renderer - server-side PDF generation

### Catalog Import
- **Excel**: openpyxl (Python) / xlsx - Node.js alternative
- **PDF**: pdf-lib + pdf-parse-extract (page text extraction)
- **Images**: sharp (extract and resize)
- **AI Fallback**: OpenAI GPT-4 for low-confidence extractions

## Data Model Decisions
- **UUID**: Use ulid for all IDs (shorter than UUID, sortable)
- **Timestamps**: All tables have createdAt, updatedAt
- **Soft Deletes**: Use `deletedAt` timestamp
- **JSON Fields**: Used for flexible attributes (tags, media, lines)

## Security Decisions
- **Password Hashing**: bcrypt with cost factor 12
- **Session**: 7-day expiry, secure, httpOnly cookies
- **CORS**: Configurable origin allowlist
- **Rate Limiting**: Per-user rate limits on auth endpoints

## File Storage
- **Local**: Local filesystem `/uploads` for development
- **Production**: S3-compatible object storage
- **PDF Storage**: Same as other assets

---
Last Updated: 2026-04-13