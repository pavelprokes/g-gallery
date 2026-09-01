-- CreateEnum
CREATE TYPE "g_gallery"."PromoTheme" AS ENUM ('LIGHT', 'DARK', 'BRAND');

-- CreateTable
CREATE TABLE "g_gallery"."PromoCard" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eyebrow" TEXT,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT NOT NULL,
    "theme" "g_gallery"."PromoTheme" NOT NULL DEFAULT 'LIGHT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."GalleryPromo" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "promoCardId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryPromo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoCard_ownerId_idx" ON "g_gallery"."PromoCard"("ownerId");

-- CreateIndex
CREATE INDEX "GalleryPromo_galleryId_enabled_idx" ON "g_gallery"."GalleryPromo"("galleryId", "enabled");

-- CreateIndex
CREATE INDEX "GalleryPromo_promoCardId_idx" ON "g_gallery"."GalleryPromo"("promoCardId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryPromo_galleryId_promoCardId_key" ON "g_gallery"."GalleryPromo"("galleryId", "promoCardId");

-- AddForeignKey
ALTER TABLE "g_gallery"."PromoCard" ADD CONSTRAINT "PromoCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."GalleryPromo" ADD CONSTRAINT "GalleryPromo_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."GalleryPromo" ADD CONSTRAINT "GalleryPromo_promoCardId_fkey" FOREIGN KEY ("promoCardId") REFERENCES "g_gallery"."PromoCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
