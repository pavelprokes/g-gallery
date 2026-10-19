-- Who is who on a gallery's faces (docs/SOCIAL-VIDEO.md §4): people the
-- photographer names by hand and the faces tagged with them. Purely additive:
-- two new tables, empty.

-- CreateTable
CREATE TABLE "g_gallery"."GalleryPerson" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "couple" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."FaceTag" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryPerson_galleryId_idx" ON "g_gallery"."GalleryPerson"("galleryId");

-- CreateIndex
CREATE INDEX "FaceTag_personId_idx" ON "g_gallery"."FaceTag"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceTag_photoId_personId_key" ON "g_gallery"."FaceTag"("photoId", "personId");

-- AddForeignKey
ALTER TABLE "g_gallery"."GalleryPerson" ADD CONSTRAINT "GalleryPerson_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."FaceTag" ADD CONSTRAINT "FaceTag_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."FaceTag" ADD CONSTRAINT "FaceTag_personId_fkey" FOREIGN KEY ("personId") REFERENCES "g_gallery"."GalleryPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
