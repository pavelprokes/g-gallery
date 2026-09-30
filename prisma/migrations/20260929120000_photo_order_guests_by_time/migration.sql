-- File-name order with guests' photos woven in by capture time
-- (docs/PHOTO-ORDER.md). Purely additive and opt-in: a new enum value no
-- gallery has, and two nullable columns nothing reads until a gallery is
-- switched to it in the admin — no existing gallery changes its order.

-- AlterEnum
ALTER TYPE "g_gallery"."PhotoOrder" ADD VALUE 'FILE_NAME_GUESTS_BY_TIME';

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "wovenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "g_gallery"."GalleryChapter" ADD COLUMN "startWovenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_wovenAt_idx" ON "g_gallery"."Photo"("galleryId", "status", "wovenAt");
