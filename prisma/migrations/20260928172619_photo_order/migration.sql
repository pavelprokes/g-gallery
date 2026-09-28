-- Photo order by file name (docs/PHOTO-ORDER.md). Additive: a new enum, three
-- columns with defaults, one index, and the functions and triggers that keep
-- the file-name keys in step with `Photo.fileName` and `GalleryChapter.startPhotoId`.

-- CreateEnum
CREATE TYPE "g_gallery"."PhotoOrder" AS ENUM ('TAKEN_AT', 'FILE_NAME');

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "photoOrder" "g_gallery"."PhotoOrder" NOT NULL DEFAULT 'TAKEN_AT';

-- AlterTable
ALTER TABLE "g_gallery"."GalleryChapter" ADD COLUMN     "startFileOrderKey" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "fileOrderKey" TEXT NOT NULL DEFAULT '';

-- A file name as a natural-sort key:
--   - lowercased, Latin diacritics folded to plain letters ("Příprava" →
--     "priprava", "Łukasz" → "lukasz"; æ, œ and ß spelled out);
--   - split into runs of digits and runs of a-z, everything else ("_", "-",
--     ".", spaces) dropped;
--   - each digit run written as its length (two digits) followed by the number
--     without leading zeros, so numbers compare by size at any length:
--     "9" → "019" < "10" → "0210", and a 13-digit phone timestamp sorts after
--     a 12-digit one. "0006" and "6" are the same number; the id breaks the tie.
-- The result is only [0-9a-z], which every collation and a plain JavaScript
-- string comparison order identically: the grid compares these keys in the
-- browser (chapter headers) against an order the database produced.
CREATE FUNCTION "g_gallery"."photo_file_order_key"(name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    string_agg(
      CASE
        WHEN m[1] ~ '^[0-9]' THEN lpad(least(length(d.digits), 99)::text, 2, '0') || d.digits
        ELSE m[1]
      END,
      '' ORDER BY n
    ),
    ''
  )
  FROM regexp_matches(
    replace(replace(replace(
      translate(
        lower(name),
        'áàâäãåăąčćçďđðéèêëěęíìîïıľĺłňńñóòôöõőøřŕšśşșťţțúùûüůűýÿžźżğ',
        'aaaaaaaacccdddeeeeeeiiiiilllnnnooooooorrsssstttuuuuuuyyzzzg'
      ),
      'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'),
    '[0-9]+|[a-z]+',
    'g'
  ) WITH ORDINALITY AS t(m, n)
  CROSS JOIN LATERAL (SELECT coalesce(nullif(ltrim(m[1], '0'), ''), '0') AS digits) AS d
$$;

-- A key that sorts after every real one: the place of a chapter that starts
-- past the last photo.
CREATE FUNCTION "g_gallery"."past_last_file_order_key"() RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT repeat('z', 64) $$;

-- Existing photos. Before the trigger exists, so each row is keyed once.
UPDATE "g_gallery"."Photo" SET "fileOrderKey" = "g_gallery"."photo_file_order_key"("fileName");

-- The app never writes the key; every insert, and any write to either column,
-- derives it from the file name here.
CREATE FUNCTION "g_gallery"."photo_set_file_order_key"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW."fileOrderKey" := "g_gallery"."photo_file_order_key"(NEW."fileName");
  RETURN NEW;
END
$$;

CREATE TRIGGER "Photo_fileOrderKey"
BEFORE INSERT OR UPDATE OF "fileName", "fileOrderKey" ON "g_gallery"."Photo"
FOR EACH ROW EXECUTE FUNCTION "g_gallery"."photo_set_file_order_key"();

-- Chapters starting on a photo that still exists take its key.
UPDATE "g_gallery"."GalleryChapter" AS c
SET "startFileOrderKey" = p."fileOrderKey"
FROM "g_gallery"."Photo" AS p
WHERE p."id" = c."startPhotoId";

-- A chapter whose starting photo was deleted begins at the next photo in
-- capture order (docs/CHAPTERS.md) — so it moves onto that photo, which puts
-- it in exactly the same place and gives it a file-name key too. If that photo
-- already starts a chapter, or there is none, the chapter was already hidden
-- (collapsed, or past the end); it stays hidden in file-name order as well.
DO $$
DECLARE
  chapter RECORD;
  next_photo RECORD;
BEGIN
  FOR chapter IN
    SELECT c."id", c."galleryId", c."startTakenAt", c."startPhotoId"
    FROM "g_gallery"."GalleryChapter" AS c
    WHERE NOT EXISTS (SELECT 1 FROM "g_gallery"."Photo" AS p WHERE p."id" = c."startPhotoId")
    ORDER BY c."startTakenAt", c."startPhotoId"
  LOOP
    SELECT p."id", coalesce(p."takenAt", p."createdAt") AS "at", p."fileOrderKey"
    INTO next_photo
    FROM "g_gallery"."Photo" AS p
    WHERE p."galleryId" = chapter."galleryId"
      AND p."status" = 'CONFIRMED'
      AND (coalesce(p."takenAt", p."createdAt"), p."id") >= (chapter."startTakenAt", chapter."startPhotoId")
    ORDER BY coalesce(p."takenAt", p."createdAt"), p."id"
    LIMIT 1;

    IF FOUND AND NOT EXISTS (
      SELECT 1 FROM "g_gallery"."GalleryChapter" AS other
      WHERE other."galleryId" = chapter."galleryId"
        AND other."startTakenAt" = next_photo."at"
        AND other."startPhotoId" = next_photo."id"
    ) THEN
      UPDATE "g_gallery"."GalleryChapter"
      SET "startTakenAt" = next_photo."at",
          "startPhotoId" = next_photo."id",
          "startFileOrderKey" = next_photo."fileOrderKey"
      WHERE "id" = chapter."id";
    ELSE
      UPDATE "g_gallery"."GalleryChapter"
      SET "startFileOrderKey" = "g_gallery"."past_last_file_order_key"()
      WHERE "id" = chapter."id";
    END IF;
  END LOOP;
END
$$;

-- New chapters take their photo's key here too, whatever wrote them — the app,
-- the seed, or a deploy's old code still running while this one rolls out.
-- A start photo that does not exist places the chapter past the last photo,
-- where it is hidden, as it is in capture order.
CREATE FUNCTION "g_gallery"."chapter_set_start_file_order_key"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  SELECT p."fileOrderKey" INTO NEW."startFileOrderKey"
  FROM "g_gallery"."Photo" AS p
  WHERE p."id" = NEW."startPhotoId";
  IF NOT FOUND THEN
    NEW."startFileOrderKey" := "g_gallery"."past_last_file_order_key"();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "GalleryChapter_startFileOrderKey"
BEFORE INSERT OR UPDATE OF "startPhotoId", "startFileOrderKey" ON "g_gallery"."GalleryChapter"
FOR EACH ROW EXECUTE FUNCTION "g_gallery"."chapter_set_start_file_order_key"();

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_fileOrderKey_idx" ON "g_gallery"."Photo"("galleryId", "status", "fileOrderKey");
