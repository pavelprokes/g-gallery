-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "webSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_webSlug_key" ON "g_gallery"."Gallery"("webSlug");
