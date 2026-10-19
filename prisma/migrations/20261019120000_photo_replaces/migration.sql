-- A PENDING upload whose bytes replace those of this CONFIRMED photo on confirm (docs/REPLACE-PHOTOS.md).
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "replacesPhotoId" TEXT;
