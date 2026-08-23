-- CreateEnum
CREATE TYPE "g_gallery"."PhotoSource" AS ENUM ('OWNER', 'GUEST');

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "source" "g_gallery"."PhotoSource" NOT NULL DEFAULT 'OWNER',
ADD COLUMN     "uploadedByViewerId" TEXT;

-- AlterTable
ALTER TABLE "g_gallery"."ShareLink" ADD COLUMN     "allowUpload" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Photo_galleryId_source_idx" ON "g_gallery"."Photo"("galleryId", "source");

-- CreateIndex
CREATE INDEX "Photo_uploadedByViewerId_idx" ON "g_gallery"."Photo"("uploadedByViewerId");

-- AddForeignKey
ALTER TABLE "g_gallery"."Photo" ADD CONSTRAINT "Photo_uploadedByViewerId_fkey" FOREIGN KEY ("uploadedByViewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
