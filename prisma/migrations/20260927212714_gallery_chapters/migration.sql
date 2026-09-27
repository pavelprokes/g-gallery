-- Chapters: named stretches of a gallery's timeline (docs/CHAPTERS.md).
-- Purely additive — a new table nothing reads before this deploy.

-- CreateTable
CREATE TABLE "g_gallery"."GalleryChapter" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "startTakenAt" TIMESTAMP(3) NOT NULL,
    "startPhotoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryChapter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GalleryChapter_galleryId_startTakenAt_startPhotoId_key" ON "g_gallery"."GalleryChapter"("galleryId", "startTakenAt", "startPhotoId");

-- AddForeignKey
ALTER TABLE "g_gallery"."GalleryChapter" ADD CONSTRAINT "GalleryChapter_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
