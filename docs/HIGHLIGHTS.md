# Highlights — "the best of the day" at the top of a gallery

Adopted 2026-09-28 (Pavel: "combination of 1 and 2" — Lightroom marks feed an automatic pick, the
photographer adjusts it in the admin). Authority for the strip of photos above the grid, the
`highlightPin` / `xmp*` columns, and the jump from a highlight to its photo.

## Why

A delivered wedding is 500–800 photos. Most people who open the link look at the first screen and
maybe a few more; ten photos that tell the whole day are what they should see first. Tapping one
takes them **to that photo's own place in the gallery**, among the shots around it — the strip is a
way into the gallery, not a second copy of it.

## Where the pick comes from

`pickHighlights` in `src/lib/gallery-highlights.ts` — pure, client-safe, called by both the guest
page (`src/lib/shared-gallery.ts`) and the admin, so the admin shows exactly what guests get.

1. **The photographer's hand wins.** `Photo.highlightPin`: `true` is always in, `false` never,
   `null` is left to the fill. Pins above `MAX_PINNED` (24) are ignored; pins alone can exceed the
   usual ten.
2. **Automatic fill for the rest of the ten seats**, only when the gallery has at least
   `MIN_PHOTOS_FOR_AUTO` (40) of the photographer's own photos — ten out of thirty is not a
   highlight. Guests' uploads are never filled in automatically, only pinned.
   - **Parts of the day**: chapters (docs/CHAPTERS.md) when there are any, else pauses in shooting
     longer than 20 minutes. Seats are shared out in proportion to each part's size (largest
     remainder), sized in photos rather than moments; a part under 3 % of the day gets none. Pins
     already in a part use its share first. In a gallery shown in file-name order
     (docs/PHOTO-ORDER.md) whose own capture times run backwards by more than a pause — a
     camera with its clock off — pauses cannot be told from camera switches, so with no chapters the
     day is cut into ten equal stretches of the photographer's own order instead.
   - **Moments**: shots less than 4 s apart (either way — see above) are one burst and yield one photo at most — but a burst
     never spans more than 15 s, or two shooters interleaving through a half-hour ceremony would
     make the whole ceremony one "burst". A burst the photographer already pinned or excluded a
     frame of — or that lies within 15 s of such a frame on the same unbroken sequence — yields
     nothing: the frame beside a pin is the same photo a second later.
   - **Within a part**: the part is cut into equal stretches, and each stretch gives its
     best-scored moment — the one nearest its middle among equals. With no marks at all this is an
     even walk through the day.

### Scoring only counts what sets a photo apart

Pavel rates nearly everything 4★ and one gallery carried the same red label on all 542 photos
(checked on two real weddings, 2026-09-28). A blanket mark is a workflow habit, not a pick, so the
score is relative to the gallery:

| Signal                               | Score                                      |
| ------------------------------------ | ------------------------------------------ |
| keyword `highlight`, `gold`, `výběr` | +10                                        |
| colour label on ≤ 25 % of the photos | +4                                         |
| stars above the gallery's usual      | +3 per star (below the usual: −3 per star) |

"Usual" is the most common rating among photos **that carry one**. A packet with no `xmp:Rating` is
stored as 0★ — Lightroom writes nothing for an unrated photo, so "stars only on the best shots" must
still score them. `null` means no XMP at all. A photo with no rating (uploaded
before marks were read, or exported without them) scores nothing for stars — it is neither above
nor below anything.

Keywords are compared without case or diacritics and deliberately exclude common words (`best`,
`top`) that would catch someone's ordinary tagging.

## Reading the marks

`src/lib/xmp-picks.ts` reads Lightroom's XMP packet (`xmp:Rating`, `xmp:Label`, `dc:subject`) from
the head of the file **in the browser at upload**, next to the capture time, and the confirm route
stores `xmpRating`, `xmpLabel`, `xmpHighlight`. A regex over the packet, not an XML parser: the
upload worker has no `DOMParser`, and the values sit in fixed places. Verified against packets
written by Lightroom (attribute form) and exiftool (element form).

The export must include metadata (Lightroom: _Include: All Metadata_). Photos uploaded before
2026-09-28 have no marks; there is no backfill — for those, pin by hand. The head of the file is
read once for both the capture time and the marks, through the same APP1 walker the GPS strip uses
(`findApp1Segment` in `src/lib/exif-gps.ts`).

**Location in XMP.** Lightroom copies GPS into the XMP packet as well as EXIF, and "All Metadata" is
exactly the export that keeps it. The upload's GPS strip therefore also blanks the values of every
`exif:GPS…` property in the XMP packet (with spaces, byte for byte, so no segment length changes
and the XML stays well-formed) — invariant #2 would otherwise hold for EXIF only.

ponytail: only coordinates. Location _text_ — `photoshop:City`, `Iptc4xmpCore:Location`, the IPTC
APP13 copy, Extended XMP — survives, and the admin hint says so rather than promising otherwise.
Blank those the same way if a photographer who fills them in ever needs it.

## Guest side

`GalleryHighlights` (`src/components/gallery-highlights.tsx`), between the header and the chapter
bar. Hidden in favourites-only mode, like chapters and promos. Laid out like the grid itself
(Pavel, 2026-09-28) — justified rows, uncropped, the grid's gap (`GRID_GAP`), edge to edge with no
side gutter — only a size up. On a phone a landscape shot fills the width alone and two portraits
share a row; wider up rows aim at 260 px and grow to fill, one or two a row on a tablet, three to four on a
desktop. It replaced a horizontal strip of 160–224 px thumbnails, which read as a row of previews to
scroll past rather than as the opening of the gallery. No hint line under the heading.

Justified in **CSS alone** (flex basis and grow both proportional to each photo's aspect ratio, a
filler keeping a short last row at the target size, and a cap at 1.6× the target so a tile left
alone on its row — a portrait before a landscape that cannot join it — does not grow to the full
width and several screens tall), not with `justifyRows`: the server renders it
exactly as it stays, so the page does not jump when the highlights would otherwise appear after
hydration, and the first tiles' images can be preloaded.

The grid list's scroll margin is re-read when anything above it resizes, not only the list itself:
the highlights' rows re-flow when the width changes.

**A highlight is never a photo in the grid's stream.** It is not in the `photos` array, so the
lightbox, arrow keys, selection, favourites, print marks and the ZIP never see it (same rule as
promos and chapter headers). Tapping it does not open a lightbox; it **jumps**:

- the same mechanics as a chapter jump — pages of metadata are pulled until the photo is in the
  grid, then one **instant** `scrollToIndex` (a smooth scroll would download every row it passes);
- the tile then takes focus (it becomes the roving tab stop) and flashes a brand-coloured outline
  for two seconds, so the eye finds it among its neighbours;
- a photo deleted since the page loaded is simply not found; nothing happens;
- turning the favourites filter on mid-jump cancels it.

The strip's own images do load photos from across the day — that is its job. The chapters spec
that asserts "nothing from the middle is requested" runs on a gallery with highlights switched off.

## Admin

`GalleryHighlightPanel` on the gallery page: the current pick with "Připnutá"/"Návrh" badges,
"Odepnout"/"Vyřadit" per photo, "Vrátit vyřazené", and "Skrýt/Ukázat hostům"
(`Gallery.highlightsEnabled`, **on by default** — the automatic pick is a sensible start that the
photographer adjusts, not something to opt into per gallery). Every grid tile below has one button
for the photo's state: pin, drop from the pick, unpin, or hand back to the pick. The pick is shown
even while switched off, so it can be reviewed first. An empty pick says why (too few photos, or
everything excluded), and more than 24 pins say which ones guests will not see.

## Not built (yet)

- **Stored pick.** Computed on every page load from all confirmed photos (a few small columns
  each). Store it on the gallery if a 2 000-photo gallery ever shows up in timings.
- **Backfilling marks** for photos uploaded before the columns existed.
- **Image analysis** (faces, sharpness, closed eyes). Would mean sending clients' photos to a
  model; the photographer's own culling is the better signal and costs nothing.
