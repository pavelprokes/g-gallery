# Photo order — capture time or file name

Adopted 2026-09-28. Authority for the order a gallery shows its photos in, and for everything that
depends on it: the grid's pages, chapter boundaries and counts, the highlights, the ZIP entry order
and the link preview's first photo.

## Why

The gallery has shown photos oldest-shot-first since 2026-08-25 — the day as it happened, read from
EXIF in the browser at upload. That is right as long as every camera's clock agrees. At a real
wedding they did not (Kamila a Petr, 2026-09-05): the main body wrote a time-zone offset an hour off
(DST not switched), the second body and the drone wrote none, and the whole main body sorted an hour
away from the others. Ignoring the offset (`src/lib/exif-taken-at.ts`, same day) fixed that case,
but not the next one — a body whose clock itself is wrong, or a photographer who reorders by hand.

The photographer already has the right order: Lightroom's, which is where the photos were culled,
corrected and sequenced. The export writes it into the file names (`svatba_0001_PPR57923.jpg`). A
gallery can now be shown in that order instead.

## The two orders

`Gallery.photoOrder`, per gallery, set in the admin (panel "Pořadí fotek"):

| Order                | Key                  | Use when                                           |
| -------------------- | -------------------- | -------------------------------------------------- |
| `TAKEN_AT` (default) | `Photo.takenAt`, ISO | originals keep their camera names; guest galleries |
| `FILE_NAME`          | `Photo.fileOrderKey` | the export numbers the files in Lightroom's order  |

Either way a photo's place is `(key, id)` — `TimelinePosition` in `src/lib/gallery-chapters.ts`,
with every query and comparison built by `src/lib/photo-order.ts`. `id` breaks ties (a burst shares a
second; two cameras can share a name).

The admin panel shows how many photos sit in a different place in the other order, so the choice is
made on this gallery's numbers, not in the abstract.

## The file-name key

`Photo.fileOrderKey` is derived from `fileName` **by the database** — a trigger on insert and on any
write to either column, calling `g_gallery.photo_file_order_key(text)`
(`prisma/migrations/*_photo_order`). The app never writes it, so no writer (the presign route, the
seed, a script) can forget it.

- Lowercased, Czech and other Latin diacritics folded to plain letters (`Příprava` → `priprava`).
- Split into runs of digits and runs of a–z; everything else (`_`, `-`, `.`, spaces) is dropped.
- Every run of digits is zero-padded to 12, so `svatba_9` sorts before `svatba_10` (natural sort)
  — the export's own padding (`0001`) does not matter, nor does crossing 999 or 9999.

The result is only `[0-9a-z]`. **That is load-bearing**: the grid places chapter headers in the
browser by comparing keys as plain JavaScript strings against an order the database produced, and
for this alphabet every collation — Postgres's `en_US.UTF-8` included — agrees with that comparison
(checked on 3 000 random keys, 2026-09-28). A key with punctuation or upper case in it would not
have that guarantee.

## What follows the order

- **Grid and cursor.** The first server-rendered page and every cursor page use `photoOrderBy`. The
  cursor carries the order it was minted in; one from the other order (the gallery was switched
  while a guest scrolled) is refused as `invalid_cursor` rather than turned into a wrong page. A
  cursor from before orders existed is read as capture time.
- **Chapters.** A chapter stores its start in both orders (`startTakenAt`, `startFileOrderKey`, with
  `startPhotoId`), so switching keeps every chapter on its photo, and on its place if that photo is
  deleted (docs/CHAPTERS.md).
- **Highlights.** Picked and ordered in the gallery's order; pauses and bursts are still measured in
  capture time, as distances, and when capture times run backwards the day is split evenly instead
  (docs/HIGHLIGHTS.md).
- **ZIP.** Live downloads and pre-built archives list entries in the gallery's order. Switching the
  order does not rebuild an existing archive — same files, and the next rebuild picks it up.
- **Link preview.** The first photo, when no cover is chosen (src/lib/share-metadata.ts).
- **Admin.** The timeline view and the ties in the "most loved first" grid.

## Guest photos

A guest's phone names its files `IMG_4821.jpg`; in file-name order those sort among the
photographer's by name, which is to say not usefully. File-name order is for galleries the
photographer delivers; a guest gallery keeps capture time. The admin hint says so.
