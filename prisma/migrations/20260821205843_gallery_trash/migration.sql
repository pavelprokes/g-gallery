-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "g_gallery";

-- CreateEnum
CREATE TYPE "g_gallery"."GalleryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "g_gallery"."PhotoStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "g_gallery"."StorageTier" AS ENUM ('STANDARD', 'INFREQUENT_ACCESS');

-- CreateEnum
CREATE TYPE "g_gallery"."ActivityType" AS ENUM ('GALLERY_VIEW', 'PHOTO_VIEW', 'REACTION', 'FAVORITE', 'DOWNLOAD', 'VISITOR_IDENTIFIED');

-- CreateEnum
CREATE TYPE "g_gallery"."ReactionKind" AS ENUM ('LOVE', 'WOW', 'LAUGH', 'SAD', 'CLAP');

-- CreateTable
CREATE TABLE "g_gallery"."user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "feedLastReadAt" TIMESTAMP(3),
    "digestSentFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "impersonatedBy" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."account" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Gallery" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3),
    "status" "g_gallery"."GalleryStatus" NOT NULL DEFAULT 'DRAFT',
    "coverPhotoId" TEXT,
    "storagePrefix" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "trashedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "lastInstantPushAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Photo" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER,
    "crc32" TEXT,
    "etag" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "placeholder" TEXT,
    "status" "g_gallery"."PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "storageTier" "g_gallery"."StorageTier" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."ShareLink" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "allowReactions" BOOLEAN NOT NULL DEFAULT true,
    "failedUnlockAttempts" INTEGER NOT NULL DEFAULT 0,
    "unlockLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Viewer" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "shareLinkId" TEXT,
    "anonKey" TEXT NOT NULL,
    "displayName" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Viewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."ViewSession" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Favorite" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Reaction" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "kind" "g_gallery"."ReactionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."ActivityEvent" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "photoId" TEXT,
    "viewerId" TEXT,
    "type" "g_gallery"."ActivityType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "g_gallery"."Keepalive" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pingedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keepalive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "g_gallery"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "g_gallery"."session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "g_gallery"."session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "g_gallery"."account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "g_gallery"."account"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "g_gallery"."verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_storagePrefix_key" ON "g_gallery"."Gallery"("storagePrefix");

-- CreateIndex
CREATE INDEX "Gallery_ownerId_status_idx" ON "g_gallery"."Gallery"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_objectKey_key" ON "g_gallery"."Photo"("objectKey");

-- CreateIndex
CREATE INDEX "Photo_galleryId_status_idx" ON "g_gallery"."Photo"("galleryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "g_gallery"."ShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareLink_galleryId_idx" ON "g_gallery"."ShareLink"("galleryId");

-- CreateIndex
CREATE UNIQUE INDEX "Viewer_galleryId_anonKey_key" ON "g_gallery"."Viewer"("galleryId", "anonKey");

-- CreateIndex
CREATE INDEX "ViewSession_galleryId_startedAt_idx" ON "g_gallery"."ViewSession"("galleryId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_photoId_viewerId_key" ON "g_gallery"."Favorite"("photoId", "viewerId");

-- CreateIndex
CREATE INDEX "Reaction_photoId_idx" ON "g_gallery"."Reaction"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_photoId_viewerId_key" ON "g_gallery"."Reaction"("photoId", "viewerId");

-- CreateIndex
CREATE INDEX "ActivityEvent_galleryId_createdAt_idx" ON "g_gallery"."ActivityEvent"("galleryId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_photoId_type_viewerId_idx" ON "g_gallery"."ActivityEvent"("photoId", "type", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "g_gallery"."PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "g_gallery"."session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Gallery" ADD CONSTRAINT "Gallery_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Photo" ADD CONSTRAINT "Photo_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ShareLink" ADD CONSTRAINT "ShareLink_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Viewer" ADD CONSTRAINT "Viewer_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Viewer" ADD CONSTRAINT "Viewer_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "g_gallery"."ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ViewSession" ADD CONSTRAINT "ViewSession_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ViewSession" ADD CONSTRAINT "ViewSession_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Favorite" ADD CONSTRAINT "Favorite_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Favorite" ADD CONSTRAINT "Favorite_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Reaction" ADD CONSTRAINT "Reaction_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."Reaction" ADD CONSTRAINT "Reaction_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ActivityEvent" ADD CONSTRAINT "ActivityEvent_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "g_gallery"."Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ActivityEvent" ADD CONSTRAINT "ActivityEvent_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "g_gallery"."Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."ActivityEvent" ADD CONSTRAINT "ActivityEvent_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "g_gallery"."Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "g_gallery"."PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
