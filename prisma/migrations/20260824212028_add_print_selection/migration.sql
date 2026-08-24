-- AlterEnum
ALTER TYPE "g_gallery"."ActivityType" ADD VALUE 'PRINT_SELECT';

-- AlterTable
ALTER TABLE "g_gallery"."ShareLink" ADD COLUMN     "allowPrintSelection" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "g_gallery"."PrintSelection" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintSelection_photoId_idx" ON "g_gallery"."PrintSelection"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintSelection_photoId_viewerId_key" ON "g_gallery"."PrintSelection"("photoId", "viewerId");

-- AddForeignKey
ALTER TABLE "g_gallery"."PrintSelection" ADD CONSTRAINT "PrintSelection_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."PrintSelection" ADD CONSTRAINT "PrintSelection_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
