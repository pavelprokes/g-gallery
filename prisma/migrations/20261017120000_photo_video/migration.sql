-- Photographer videos in a gallery (docs/VIDEO.md). Purely additive: two
-- nullable columns that stay null on every existing photo.

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "videoObjectKey" TEXT,
ADD COLUMN "durationMs" INTEGER;
