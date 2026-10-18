-- The photo check (docs/SOCIAL-VIDEO.md §4): when the photographer kept a
-- photo the check flagged. Purely additive: one nullable column, null on every
-- existing photo.

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "checkKeptAt" TIMESTAMP(3);
