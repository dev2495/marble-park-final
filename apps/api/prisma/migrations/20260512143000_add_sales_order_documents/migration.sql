-- Store generated document references on sales orders. The PDF itself is
-- rendered on demand, but the order keeps stable URLs for forwarding and audit.
ALTER TABLE "SalesOrder"
  ADD COLUMN IF NOT EXISTS "documents" JSONB NOT NULL DEFAULT '{}';
