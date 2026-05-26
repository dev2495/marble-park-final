ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "permissionOverrides" JSONB NOT NULL DEFAULT '{}'::jsonb;
