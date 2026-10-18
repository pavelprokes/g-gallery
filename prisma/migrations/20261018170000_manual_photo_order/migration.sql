-- A gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order). Additive:
-- a new enum value, nullable or defaulted columns, an index and a trigger.

-- AlterEnum
ALTER TYPE "g_gallery"."PhotoOrder" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN "manualOrderAt" TIMESTAMP(3);
ALTER TABLE "g_gallery"."GalleryChapter" ADD COLUMN "startManualKey" TEXT;
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "manualOrderKey" TEXT NOT NULL DEFAULT '';

-- Every photo's provisional key: "z" + its file-name key, after any key placed
-- by hand (those stay below "z"). Before the trigger, so each row is written once.
UPDATE "g_gallery"."Photo" SET "manualOrderKey" = 'z' || "fileOrderKey";

-- New photos get the same. Named so it fires after "Photo_fileOrderKey"
-- (triggers on one event fire in name order), whose key it reads.
CREATE FUNCTION "g_gallery"."photo_set_manual_order_key"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."manualOrderKey" IS NULL OR NEW."manualOrderKey" = '' THEN
    NEW."manualOrderKey" := 'z' || NEW."fileOrderKey";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Photo_manualOrderKey"
BEFORE INSERT OR UPDATE OF "manualOrderKey" ON "g_gallery"."Photo"
FOR EACH ROW EXECUTE FUNCTION "g_gallery"."photo_set_manual_order_key"();

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_manualOrderKey_idx" ON "g_gallery"."Photo"("galleryId", "status", "manualOrderKey");
