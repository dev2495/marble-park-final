ALTER TABLE "AppSetting"
  ALTER COLUMN "logoUrl" SET DEFAULT '/brand/marble-park-logo.png';

UPDATE "AppSetting"
SET "logoUrl" = '/brand/marble-park-logo.png',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "logoUrl" = '/brand/marble-park-logo.jpg'
   OR "logoUrl" = '';
