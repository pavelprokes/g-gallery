-- Photo order by file name (docs/PHOTO-ORDER.md). Additive: a new enum, two
-- columns with defaults, one index, and the function + trigger that keep
-- `Photo.fileOrderKey` in step with `Photo.fileName`.

-- CreateEnum
CREATE TYPE "g_gallery"."PhotoOrder" AS ENUM ('TAKEN_AT', 'FILE_NAME');

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "photoOrder" "g_gallery"."PhotoOrder" NOT NULL DEFAULT 'TAKEN_AT';

-- AlterTable
ALTER TABLE "g_gallery"."GalleryChapter" ADD COLUMN     "startFileOrderKey" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "fileOrderKey" TEXT NOT NULL DEFAULT '';

-- A file name as a sort key: lowercased, Czech and other Latin diacritics
-- folded to plain letters ("Příprava" → "priprava"), split into runs of digits
-- and runs of a-z (everything else — "_", "-", "." — dropped), each digit run
-- zero-padded to 12 so that "svatba_9" sorts before "svatba_10". The result is
-- only [0-9a-z], which every collation and a plain JavaScript string
-- comparison order identically: the grid compares these keys in the browser
-- (chapter headers) against an order the database produced.
CREATE FUNCTION "g_gallery"."photo_file_order_key"(name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    string_agg(
      CASE WHEN m[1] ~ '^[0-9]' THEN lpad(m[1], greatest(12, length(m[1])), '0') ELSE m[1] END,
      '' ORDER BY n
    ),
    ''
  )
  FROM regexp_matches(
    translate(lower(name), 'áàâäãåčćçďéèêëěíìîïľĺňńñóòôöõőřŕšśťúùûüůűýÿžźż', 'aaaaaacccdeeeeeiiiillnnnoooooorrsstuuuuuuyyzzz'),
    '[0-9]+|[a-z]+',
    'g'
  ) WITH ORDINALITY AS t(m, n)
$$;

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

-- Existing photos, and the chapters that start on them.
UPDATE "g_gallery"."Photo" SET "fileOrderKey" = "g_gallery"."photo_file_order_key"("fileName");

UPDATE "g_gallery"."GalleryChapter" AS c
SET "startFileOrderKey" = p."fileOrderKey"
FROM "g_gallery"."Photo" AS p
WHERE p."id" = c."startPhotoId";

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_fileOrderKey_idx" ON "g_gallery"."Photo"("galleryId", "status", "fileOrderKey");
