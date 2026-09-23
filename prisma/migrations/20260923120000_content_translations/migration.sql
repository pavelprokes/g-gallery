-- Guest-facing translations of the text the photographer types into the admin
-- (docs/I18N.md §Content): wedding title and venue, gallery title, promo card
-- copy. One JSONB object per row, keyed by locale — `{ "en": { "title": … } }`.
--
-- Purely additive: existing rows get `{}`, which every reader treats as "no
-- translation, show the Czech original". Nothing reads the column before this
-- deploy, and dropping it later would still be a two-deploy change.

-- AlterTable
ALTER TABLE "g_gallery"."Event" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "g_gallery"."Gallery" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "g_gallery"."PromoCard" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
