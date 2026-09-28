-- File-name order becomes the default (docs/PHOTO-ORDER.md, 2026-09-28): the
-- photographer exports from Lightroom with a sequence in the file names, and
-- that sequence is the order the day was edited in.

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ALTER COLUMN "photoOrder" SET DEFAULT 'FILE_NAME';

-- Existing galleries switch only where the file names plainly are such a
-- sequence — so none whose order would get worse:
--   - no guests' gallery: no upload link, no guest photos (phones name files
--     by their own counters, which says nothing about the day);
--   - and either no photos yet (it takes the new default like a new gallery),
--     or every photo's name starts the same way and its first number is
--     distinct, together running almost without gaps (svatba_0001 …
--     svatba_0542, a few deleted after export) — two camera bodies' own
--     counters (DSC_4211, _MG_0873) never do, and names whose start changes
--     along the sequence (pripravy_0001 … obrad_0081 …) would sort by that
--     start, alphabetically, rather than by the number.
-- Anything else keeps capture time, and the admin can switch it by hand.
UPDATE "g_gallery"."Gallery" AS g
SET "photoOrder" = 'FILE_NAME'
WHERE g."photoOrder" = 'TAKEN_AT'
  AND NOT EXISTS (
    SELECT 1 FROM "g_gallery"."ShareLink" AS l WHERE l."galleryId" = g."id" AND l."allowUpload"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "g_gallery"."Photo" AS p WHERE p."galleryId" = g."id" AND p."source" = 'GUEST'
  )
  AND (
    NOT EXISTS (
      SELECT 1 FROM "g_gallery"."Photo" AS p WHERE p."galleryId" = g."id" AND p."status" = 'CONFIRMED'
    )
    OR g."id" IN (
    SELECT numbered."galleryId"
    FROM (
      SELECT
        p."galleryId",
        substring(p."fileName" FROM '[0-9]+')::numeric AS n,
        lower(substring(p."fileName" FROM '^[^0-9]*')) AS prefix
      FROM "g_gallery"."Photo" AS p
      WHERE p."status" = 'CONFIRMED'
    ) AS numbered
    GROUP BY numbered."galleryId"
    HAVING count(*) >= 2
      AND count(numbered.n) = count(*)
      AND count(DISTINCT numbered.n) = count(*)
      AND count(DISTINCT numbered.prefix) = 1
      AND max(numbered.n) - min(numbered.n) + 1 <= count(*) * 1.2
    )
  );
