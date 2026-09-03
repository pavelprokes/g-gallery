-- When the gallery's set of CONFIRMED photos last changed, so the background
-- ZIP build can wait for a gallery to settle before spending hundreds of part
-- messages on it (docs/TODO.md §7a). Nullable: existing rows fall back to the
-- newest photo's createdAt, which is the right answer for a gallery nobody has
-- touched since.
ALTER TABLE "g_gallery"."Gallery"
  ADD COLUMN "photosChangedAt" TIMESTAMP(3);
