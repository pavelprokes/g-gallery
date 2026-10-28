-- CreateTable
CREATE TABLE "g_gallery"."InstagramConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "igUsername" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "userTokenCipher" TEXT NOT NULL,
    "userTokenExpiresAt" TIMESTAMP(3),
    "pageTokenCipher" TEXT,
    "tokenKind" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramConnection_ownerId_key" ON "g_gallery"."InstagramConnection"("ownerId");

-- AddForeignKey
ALTER TABLE "g_gallery"."InstagramConnection" ADD CONSTRAINT "InstagramConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
