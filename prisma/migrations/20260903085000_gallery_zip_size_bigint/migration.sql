-- A delivered wedding archive is routinely 6-8 GB. `Int` is int4, which stops
-- at 2,147,483,647 (2.147 GB), so every callback reporting a larger archive
-- failed with a 500 and the archive could never be recorded — however many
-- times it was rebuilt (docs/TODO.md §7g).
--
-- Widening int4 to int8 preserves every existing value and needs no rewrite of
-- the rows' meaning; Postgres rewrites the table, which at this table's size is
-- instant.
ALTER TABLE "g_gallery"."Gallery"
  ALTER COLUMN "zipSizeBytes" TYPE BIGINT;
