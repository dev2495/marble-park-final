-- Profile fields for the /profile page: optional avatar URL, optional bio,
-- and an audit timestamp for the most recent password change. All nullable
-- so existing users continue to validate without backfill.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "bio" TEXT,
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
