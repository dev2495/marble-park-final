-- Quotes used to be saved with fixed terms and bank text that no person typed.
-- Clear exactly that text so each quote document shows the current Settings
-- (Default terms, Bank details). Anything typed for a quote is left as it is.
UPDATE "Quote"
SET "quoteMeta" = "quoteMeta" - 'terms'
WHERE jsonb_typeof("quoteMeta") = 'object'
  AND "quoteMeta"->>'terms' IN (
    'Prices are valid until the quote validity date. Installation, civil work and unloading are excluded unless mentioned.',
    'Prices are valid until the quote validity date. Delivery depends on stock availability. Installation, civil work and unloading are excluded unless mentioned.'
  );

UPDATE "Quote"
SET "quoteMeta" = "quoteMeta" - 'bankDetails'
WHERE jsonb_typeof("quoteMeta") = 'object'
  AND "quoteMeta"->>'bankDetails' = 'Bank details will be shared by Marble Park accounts team at order confirmation.';
