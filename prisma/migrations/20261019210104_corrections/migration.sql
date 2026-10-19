-- AlterEnum
ALTER TYPE "g_gallery"."ActivityType" ADD VALUE 'CORRECTION';

-- AlterTable
ALTER TABLE "g_gallery"."ShareLink" ADD COLUMN     "allowCorrections" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correctionFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "correctionLockedUntil" TIMESTAMP(3),
ADD COLUMN     "correctionPinCipher" TEXT,
ADD COLUMN     "correctionPinHash" TEXT;

-- CreateTable
CREATE TABLE "g_gallery"."PhotoComment" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoComment_photoId_idx" ON "g_gallery"."PhotoComment"("photoId");

-- CreateIndex
CREATE INDEX "PhotoComment_shareLinkId_idx" ON "g_gallery"."PhotoComment"("shareLinkId");

-- AddForeignKey
ALTER TABLE "g_gallery"."PhotoComment" ADD CONSTRAINT "PhotoComment_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."PhotoComment" ADD CONSTRAINT "PhotoComment_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "g_gallery"."ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
