-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "failedUnlockAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unlockLockedUntil" TIMESTAMP(3);
