ALTER TABLE "AppSetting"
  ADD COLUMN "logoUrl" TEXT NOT NULL DEFAULT '/brand/marble-park-logo.jpg',
  ADD COLUMN "companyAddress" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "gstNumber" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "website" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "quotationTitle" TEXT NOT NULL DEFAULT 'PROFORMA / QUOTATION',
  ADD COLUMN "documentTagline" TEXT NOT NULL DEFAULT 'Premium bath, tile and surface selections for considered spaces.',
  ADD COLUMN "defaultTerms" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bankDetails" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "documentFooter" TEXT NOT NULL DEFAULT '';

UPDATE "AppSetting"
SET
  "companyAddress" = 'Near DCB Bank, Char Rasta, Vapi (Guj)-396191, India',
  "gstNumber" = '24AHPPS9407D1Z3',
  "supportPhone" = CASE WHEN "supportPhone" = '' THEN '0260-2424498 · 9427119271 · 7506133166 · 9712508070' ELSE "supportPhone" END,
  "defaultTerms" = E'1. Freight and labour are extra and subject to applicable GST.\n2. Payment is 100% advance unless otherwise agreed in writing.\n3. Goods once sold cannot be returned except through an approved return.\n4. Confirmed orders cannot be cancelled without written approval.\n5. Tile spacers must be used as recommended by the manufacturer.\n6. Product images are references and may vary from the supplied product.',
  "bankDetails" = E'Account name: Marble Park\nBank: IDFC Bank\nAccount no.: 10033526350\nIFSC: IDFB0042441\nBranch: Vapi - 396195, Gujarat',
  "documentFooter" = 'Thank you for choosing Marble Park. Product availability, shade and batch are confirmed at order stage.';
