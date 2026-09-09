-- Additive migration. Preserve historical events and their legacy read timestamps.
ALTER TABLE "Notification"
 ADD COLUMN "taskKey" TEXT, ADD COLUMN "category" TEXT NOT NULL DEFAULT 'updates',
 ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal', ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open',
 ADD COLUMN "targetPermission" TEXT, ADD COLUMN "assignedUserId" TEXT, ADD COLUMN "dueAt" TIMESTAMP(3),
 ADD COLUMN "resolvedAt" TIMESTAMP(3), ADD COLUMN "reconciledAt" TIMESTAMP(3), ADD COLUMN "deliveredAt" TIMESTAMP(3),
 ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "deliveryError" TEXT, ADD COLUMN "retryAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Notification_taskKey_key" ON "Notification"("taskKey");
CREATE INDEX "Notification_deliveredAt_retryAt_idx" ON "Notification"("deliveredAt", "retryAt");
CREATE INDEX "Notification_category_status_dueAt_idx" ON "Notification"("category", "status", "dueAt");
CREATE TABLE "NotificationRecipient" (
 "notificationId" TEXT NOT NULL REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" TEXT NOT NULL, "readAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3), "snoozedUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("notificationId", "userId")
);
CREATE INDEX "NotificationRecipient_userId_archivedAt_readAt_idx" ON "NotificationRecipient"("userId", "archivedAt", "readAt");
CREATE TABLE "NotificationPreference" ("userId" TEXT PRIMARY KEY, "muteUpdates" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
-- Never infer a personal read receipt from a shared role read flag.
INSERT INTO "NotificationRecipient" ("notificationId", "userId", "readAt")
 SELECT n.id, u.id, CASE WHEN n."targetUserId" = u.id THEN n."readAt" ELSE NULL END
 FROM "Notification" n JOIN "User" u ON u.active AND
 (n."targetUserId" = u.id OR (n."targetUserId" IS NULL AND n."targetRole" = u.role))
 ON CONFLICT DO NOTHING;
-- Historical broadcasts without an explicit audience are quarantined, not exposed to everyone.
UPDATE "Notification" SET "deliveredAt" = CURRENT_TIMESTAMP;
-- Coalesce historical updates without deleting events or guessing that users read them.
UPDATE "NotificationRecipient" r SET "archivedAt" = CURRENT_TIMESTAMP
FROM (
 SELECT r2."notificationId", r2."userId",
 row_number() OVER (PARTITION BY r2."userId", n.type, n."entityId" ORDER BY n."createdAt" DESC, n.id DESC) AS rank
 FROM "NotificationRecipient" r2 JOIN "Notification" n ON n.id = r2."notificationId"
 WHERE n."entityId" IS NOT NULL
) duplicate
WHERE r."notificationId" = duplicate."notificationId" AND r."userId" = duplicate."userId" AND duplicate.rank > 1;
-- Old threshold messages are superseded by source-reconciled stock tasks.
UPDATE "NotificationRecipient" r SET "archivedAt" = CURRENT_TIMESTAMP
FROM "Notification" n WHERE r."notificationId" = n.id AND n.type IN ('stock_warning','stock_critical');
