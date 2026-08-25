-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "takenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_takenAt_idx" ON "g_gallery"."Photo"("galleryId", "status", "takenAt");

-- Baseline for the back catalogue: upload time stands in for capture time so
-- the timeline query never has to deal with a NULL on a confirmed photo.
-- `scripts/backfill-taken-at.ts` then refines this from the originals' EXIF.
UPDATE "g_gallery"."Photo" SET "takenAt" = "createdAt" WHERE "takenAt" IS NULL;
