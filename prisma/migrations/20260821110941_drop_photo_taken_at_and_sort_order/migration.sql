-- DropIndex
DROP INDEX "Photo_galleryId_status_sortOrder_idx";

-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "sortOrder",
DROP COLUMN "takenAt";

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_idx" ON "Photo"("galleryId", "status");

