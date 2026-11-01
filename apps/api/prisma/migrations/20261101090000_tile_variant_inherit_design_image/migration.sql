-- Tile variants used to receive a one-time copy of their design's image when
-- created, so a later design image never reached quotes, search or labels.
-- From now on a variant without its own image inherits the design image and
-- carries "inheritedFromDesignId"; the application keeps it in sync.

-- 1. Variants whose image is exactly the design's copied image: mark as inherited.
UPDATE "Product" AS p
SET "media" = p."media" || jsonb_build_object('inheritedFromDesignId', d."id"),
    "updatedAt" = NOW()
FROM "TileDesign" AS d
WHERE p."tileDesignId" = d."id"
  AND p."media" IS NOT NULL
  AND p."media" <> '{}'::jsonb
  AND (p."media" - 'inheritedFromDesignId') = d."media"
  AND NOT (p."media" ? 'inheritedFromDesignId');

-- 2. Variants with no image whose design has one: inherit it.
UPDATE "Product" AS p
SET "media" = d."media" || jsonb_build_object('inheritedFromDesignId', d."id"),
    "updatedAt" = NOW()
FROM "TileDesign" AS d
WHERE p."tileDesignId" = d."id"
  AND p."status" <> 'archived'
  AND COALESCE(p."media"->>'primaryUrl', p."media"->>'primaryImage', p."media"->>'url', p."media"->>'imageUrl', '') = ''
  AND jsonb_array_length(COALESCE(p."media"->'gallery', p."media"->'images', '[]'::jsonb)) = 0
  AND (
    COALESCE(d."media"->>'primaryUrl', d."media"->>'primaryImage', '') <> ''
    OR jsonb_array_length(COALESCE(d."media"->'gallery', d."media"->'images', '[]'::jsonb)) > 0
  );
