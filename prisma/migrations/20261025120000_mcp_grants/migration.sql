-- "Connect Claude" consents for the MCP endpoint (docs/MCP.md). Purely
-- additive: one new, empty table.

-- CreateTable
CREATE TABLE "g_gallery"."McpGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "codeUsedAt" TIMESTAMP(3),
    "accessHash" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "refreshHash" TEXT,
    "previousRefreshHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_codeHash_key" ON "g_gallery"."McpGrant"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_accessHash_key" ON "g_gallery"."McpGrant"("accessHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_refreshHash_key" ON "g_gallery"."McpGrant"("refreshHash");

-- CreateIndex
CREATE UNIQUE INDEX "McpGrant_previousRefreshHash_key" ON "g_gallery"."McpGrant"("previousRefreshHash");

-- CreateIndex
CREATE INDEX "McpGrant_userId_idx" ON "g_gallery"."McpGrant"("userId");

-- AddForeignKey
ALTER TABLE "g_gallery"."McpGrant" ADD CONSTRAINT "McpGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "g_gallery"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
