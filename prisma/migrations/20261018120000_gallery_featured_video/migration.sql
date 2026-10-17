-- The film shown above a gallery's highlights (docs/VIDEO.md). Purely additive:
-- one nullable column, null on every existing gallery.

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN "featuredVideoId" TEXT;

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_featuredVideoId_fkey" FOREIGN KEY ("featuredVideoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
