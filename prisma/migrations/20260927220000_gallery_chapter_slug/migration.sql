-- Chapter link anchors (docs/CHAPTERS.md §Links). Additive: a nullable column
-- and a unique index; existing rows keep null and link by their id instead.

-- AlterTable
ALTER TABLE "g_gallery"."GalleryChapter" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GalleryChapter_galleryId_slug_key" ON "g_gallery"."GalleryChapter"("galleryId", "slug");
