-- Phone is the customer identity, compared on its last 10 digits however it was
-- typed. Must match CUSTOMER_MOBILE_KEY_SQL in src/modules/common/phone.ts.
-- Not unique yet: existing duplicates are listed by
-- scripts/normalise-customer-mobiles.ts and resolved by people first.
CREATE INDEX IF NOT EXISTS "Customer_mobile_key_idx"
  ON "Customer" ((right(regexp_replace("mobile", '[^0-9]', '', 'g'), 10)));
