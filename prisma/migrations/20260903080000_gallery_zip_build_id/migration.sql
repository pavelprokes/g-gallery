-- Identity of the build allowed to report a result (docs/TODO.md §7c).
--
-- The staleness fence used to be described as `zipUploadId`, but nothing ever
-- cleared that column, so a build superseded by an admin edit still matched its
-- own callback and was recorded as current — archive and all, including photos
-- the admin had just deleted. This column is cleared the moment a gallery's
-- photos change, which is what makes the fence real.
--
-- Nullable and additive. Existing rows read as "no build is authoritative",
-- which is correct: any build in flight during the deploy is superseded by it.
ALTER TABLE "g_gallery"."Gallery"
  ADD COLUMN "zipBuildId" TEXT;
