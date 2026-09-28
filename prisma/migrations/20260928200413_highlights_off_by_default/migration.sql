-- The highlights are off by default (docs/HIGHLIGHTS.md, 2026-09-28): the
-- photographer turns them on for a gallery once the pick is worth showing.

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ALTER COLUMN "highlightsEnabled" SET DEFAULT false;

-- Existing galleries got them on by default a day ago; they go off too,
-- except where the photographer has already worked on the pick — pinned a
-- photo in or excluded one — the one sign it was looked at and meant.
UPDATE "g_gallery"."Gallery" AS g
SET "highlightsEnabled" = false
WHERE g."highlightsEnabled"
  AND NOT EXISTS (
    SELECT 1 FROM "g_gallery"."Photo" AS p
    WHERE p."galleryId" = g."id" AND p."status" = 'CONFIRMED' AND p."highlightPin" IS NOT NULL
  );
