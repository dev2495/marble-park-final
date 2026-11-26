-- Stock lane: how a challan travels (vehicle or customer pickup). Nullable: older challans keep null.
ALTER TABLE "DispatchChallan" ADD COLUMN IF NOT EXISTS "transportMode" TEXT;
