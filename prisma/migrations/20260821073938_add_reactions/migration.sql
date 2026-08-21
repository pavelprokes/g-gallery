-- CreateEnum
CREATE TYPE "ReactionKind" AS ENUM ('LOVE', 'WOW', 'LAUGH', 'SAD', 'CLAP');

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "kind" "ReactionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reaction_photoId_idx" ON "Reaction"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_photoId_viewerId_key" ON "Reaction"("photoId", "viewerId");

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

