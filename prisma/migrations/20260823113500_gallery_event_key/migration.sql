-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "eventKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_eventId_eventKey_key" ON "g_gallery"."Gallery"("eventId", "eventKey");
