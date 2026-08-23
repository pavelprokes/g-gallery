-- CreateEnum
CREATE TYPE "g_gallery"."ZipStatus" AS ENUM ('NONE', 'PENDING', 'BUILDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN     "zipBuiltAt" TIMESTAMP(3),
ADD COLUMN     "zipObjectKey" TEXT,
ADD COLUMN     "zipPartsExpected" INTEGER,
ADD COLUMN     "zipSizeBytes" INTEGER,
ADD COLUMN     "zipStatus" "g_gallery"."ZipStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "zipUploadId" TEXT;

-- CreateIndex
CREATE INDEX "Gallery_zipStatus_idx" ON "g_gallery"."Gallery"("zipStatus");
