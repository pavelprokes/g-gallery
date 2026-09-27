-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "highlightsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN     "highlightPin" BOOLEAN,
ADD COLUMN     "xmpHighlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "xmpLabel" TEXT,
ADD COLUMN     "xmpRating" INTEGER;
