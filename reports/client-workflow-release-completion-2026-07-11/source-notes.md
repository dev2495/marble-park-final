# Source Notes

- Local release gate: `npm run smoke:client-workflow` with `DATABASE_URL=postgresql://devarshthakkar@localhost:5432/marble_park_release_gate` and a compiled API on port 4100.
- Migration rehearsal: `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` against the isolated `marble_park_release_gate` database.
- Builds: `npm run db:generate --workspace=apps/api`, `npm run build:api`, and `npm run build:web` passed on July 11, 2026.
- Browser QA: authenticated local browser session reached Product Master and a completed partial-order quote through the web app on port 3000 and API on port 4000.
- Dependency audit: `npm audit --omit=dev --json` was re-run after upgrading Nodemailer to 9.0.3. The remaining Nest GraphQL/WebSocket, Next bundled PostCSS, ExcelJS/UUID, and development Esbuild findings do not have a safe non-major automated remediation in npm's current resolver output.
- Deployment was not attempted. The report does not assert current Railway service state or production database contents.
