-- AlterEnum
ALTER TYPE "g_gallery"."ActivityType" ADD VALUE 'PROMO_CLICK';

-- CreateTable
CREATE TABLE "g_gallery"."ViewerTransfer" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewerTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewerTransfer_viewerId_key" ON "g_gallery"."ViewerTransfer"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewerTransfer_codeHash_key" ON "g_gallery"."ViewerTransfer"("codeHash");

-- CreateIndex
CREATE INDEX "ViewerTransfer_expiresAt_idx" ON "g_gallery"."ViewerTransfer"("expiresAt");

-- AddForeignKey
ALTER TABLE "g_gallery"."ViewerTransfer" ADD CONSTRAINT "ViewerTransfer_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
