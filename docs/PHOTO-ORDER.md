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

| Order                 | Key                  | Use when                                             |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `FILE_NAME` (default) | `Photo.fileOrderKey` | the export numbers the files in Lightroom's order    |
| `TAKEN_AT`            | `Photo.takenAt`, ISO | guests' galleries; originals with their camera names |

File-name order is the default since 2026-09-28 (Pavel: the photographer exports from Lightroom
with a sequence "almost always"). A **guests' gallery** gets capture time instead, set where one is made as such: the wedding
page's "pro hosty" gallery (`createGalleryForEvent`). Ticking uploads on a link does not change the
order — a delivery may let guests add a few, and an explicit choice in the admin is never
overridden; the admin hint points a standalone guests' gallery at capture time. The default's migration
switched existing galleries only where it could not make things worse — no upload link, no guest
photos, and either no photos yet or file names whose first numbers are distinct and run almost
without gaps (an export sequence; two bodies' camera counters never do).

Either way a photo's place is `(key, id)` — `TimelinePosition` in `src/lib/gallery-chapters.ts`,
with every query and comparison built by `src/lib/photo-order.ts`. `id` breaks ties (a burst shares a
second; two cameras can share a name).

The admin panel says how many photos the other order would move — the gallery minus the longest
run both orders keep in the same relative order, so one photo moved five places counts once — and
the choice is made on this gallery's numbers, not in the abstract.

## The file-name key

`Photo.fileOrderKey` is derived from `fileName` **by the database** — a trigger on insert and on any
write to either column, calling `g_gallery.photo_file_order_key(text)`
(`prisma/migrations/*_photo_order`). The app never writes it, so no writer (the presign route, the
seed, a script) can forget it.

- Lowercased; Latin diacritics folded to plain letters (`Příprava` → `priprava`, `Łukasz` →
  `lukasz`; `æ`, `œ`, `ß` spelled out).
- Split into runs of digits and runs of a–z; everything else (`_`, `-`, `.`, spaces) is dropped.
- Every number is written as its length (three digits — a file name is at most 512 characters)
  followed by its digits without leading zeros: `9` → `0019`, `10` → `00210`. Numbers compare by size at any length — `svatba_9` before
  `svatba_10`, a 13-digit phone timestamp after a 12-digit one — and the export's own padding
  (`0001`) makes no difference. `0006` and `6` are the same number; the id breaks the tie.

The result is only `[0-9a-z]`. **That is load-bearing**: the grid places chapter headers in the
browser by comparing keys as plain JavaScript strings against an order the database produced, and
for this alphabet every collation — Postgres's `en_US.UTF-8` included — agrees with that comparison
(checked on 3 000 random keys, 2026-09-28). A key with punctuation or upper case in it would not
have that guarantee.

`GalleryChapter.startFileOrderKey` is filled in the same way, by a trigger from `startPhotoId`: the
start photo's key, or — for a start photo that does not exist — a key past every photo
(`g_gallery.past_last_file_order_key()`), where the chapter is hidden exactly as it is in capture
order. A later write that keeps the same start photo keeps the key: the photo may have been
deleted since, and the stored key is what holds the chapter in place. The migration gave each chapter whose start photo had already been deleted the photo it had
been starting at since: the next one in capture order (latest chapter first, so of several
collapsing onto one photo, the one guests saw keeps it).

## What follows the order

- **Grid and cursor.** The first server-rendered page and every cursor page use `photoOrderBy`. The
  cursor carries the order it was minted in. A gallery switched while a guest has it open answers
  that guest's next page with `409 order_changed` — and a refetch of the first page reports the new
  `order` — and the page **reloads**: its loaded photos, chapter starts and highlights all came in
  the old order, and splicing the new one onto them would misplace every chapter header. A cursor
  from before orders existed is read as capture time.
- **Chapters.** A chapter stores its start in both orders (`startTakenAt`, `startFileOrderKey`, with
  `startPhotoId`), so switching keeps every chapter on its photo, and on its place if that photo is
  deleted (docs/CHAPTERS.md).
- **Highlights.** Picked and ordered in the gallery's order; pauses and bursts are still measured in
  capture time, as distances. When the photographer's own capture times run backwards by more than
  a pause (a camera's clock off) and there are no chapters, the day is split evenly instead
  (docs/HIGHLIGHTS.md).
- **ZIP.** Live downloads and pre-built archives list entries in the gallery's order. Switching the
  order does not rebuild an existing archive — same files, and the next rebuild picks it up.
- **Link preview.** The first photo, when no cover is chosen (src/lib/share-metadata.ts).
- **Admin.** The timeline view and the ties in the "most loved first" grid.

## Guest photos

A guest's phone names its files `IMG_4821.jpg`; in file-name order those sort among the
photographer's by name, which is to say not usefully. File-name order is for galleries the
photographer delivers; a guests' gallery is given capture time when it is made (above), and the
admin hint says so.
