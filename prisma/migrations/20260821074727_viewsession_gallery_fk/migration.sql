-- AddForeignKey
ALTER TABLE "ViewSession" ADD CONSTRAINT "ViewSession_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

