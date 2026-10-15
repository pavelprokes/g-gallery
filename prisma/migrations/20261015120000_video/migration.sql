-- Video in a gallery (docs/VIDEO.md). Purely additive: a new enum whose
-- default makes every existing row a photo, two nullable columns only video
-- rows ever fill, and a nullable featured-film pointer no gallery has yet.

-- CreateEnum
CREATE TYPE "g_gallery"."MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "featuredVideoId" TEXT;

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "kind" "g_gallery"."MediaKind" NOT NULL DEFAULT 'PHOTO',
ADD COLUMN     "posterObjectKey" TEXT;

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_featuredVideoId_fkey" FOREIGN KEY ("featuredVideoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
