-- Consecutive failed background ZIP builds, so the cron can retry a FAILED
-- gallery on a backoff instead of leaving it stuck forever (docs/TODO.md §7).
-- Additive with a default: existing rows read as "never failed", which is the
-- right starting point for the retry policy.
ALTER TABLE "g_gallery"."Gallery"
  ADD COLUMN "zipAttempts" INTEGER NOT NULL DEFAULT 0;
