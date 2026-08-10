-- Preserve every existing session while recording its last known server-side
-- activity point. Deployment will enforce the new 15-minute expiry policy for
-- newly created and explicitly refreshed sessions.
ALTER TABLE "Session"
ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- No browser that was authenticated before this migration may retain a
-- legacy seven-day window. Existing sessions receive at most 15 minutes from
-- the migration boundary and still remain revocable by the normal logout path.
UPDATE "Session"
SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP + INTERVAL '15 minutes'),
    "lastActivityAt" = CURRENT_TIMESTAMP;
