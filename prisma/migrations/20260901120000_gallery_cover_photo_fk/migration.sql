-- Nothing has ever written "coverPhotoId", but the column has existed since the
-- init migration — clear anything unexpected first so the constraint below can
-- be added without a validation error on production data.
UPDATE "g_gallery"."Gallery" g
SET "coverPhotoId" = NULL
WHERE g."coverPhotoId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "g_gallery"."Photo" p WHERE p."id" = g."coverPhotoId");

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
