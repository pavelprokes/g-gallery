-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "eventLinkId" TEXT,
ADD COLUMN     "listedOnEvent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "g_gallery"."Event" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "venue" TEXT,
    "tokenHash" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "trashedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_tokenHash_key" ON "g_gallery"."Event"("tokenHash");

-- CreateIndex
CREATE INDEX "Event_ownerId_trashedAt_idx" ON "g_gallery"."Event"("ownerId", "trashedAt");

-- CreateIndex
CREATE INDEX "Gallery_eventId_position_idx" ON "g_gallery"."Gallery"("eventId", "position");

-- AddForeignKey
ALTER TABLE "g_gallery"."Event" ADD CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "g_gallery"."Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_eventLinkId_fkey" FOREIGN KEY ("eventLinkId") REFERENCES "g_gallery"."ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
