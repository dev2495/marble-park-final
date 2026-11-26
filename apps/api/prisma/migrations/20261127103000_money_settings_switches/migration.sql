-- Two Settings switches for the accountant. Both default to today's behaviour:
-- numbering restarts on 1 January, and invoices print as they do now.
ALTER TABLE "AppSetting" ADD COLUMN IF NOT EXISTS "documentNumberingPeriod" TEXT NOT NULL DEFAULT 'calendar';
ALTER TABLE "AppSetting" ADD COLUMN IF NOT EXISTS "invoiceGstSplitEnabled" BOOLEAN NOT NULL DEFAULT false;
