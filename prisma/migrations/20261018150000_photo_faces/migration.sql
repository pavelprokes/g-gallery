-- Face boxes for the social-video camera (docs/SOCIAL-VIDEO.md §4). Purely
-- additive: one nullable column, null on every existing photo until the admin
-- detects faces on it.

-- AlterTable
ALTER TABLE "g_gallery"."Photo" ADD COLUMN "faces" JSONB;
