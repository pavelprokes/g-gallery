# Chapters — named stretches of a gallery's timeline

Adopted 2026-09-27. Authority for anything that groups a gallery's photos into named parts
("Přípravy", "Obřad", "První tanec") or lets a guest jump between them.

## Why

A delivered wedding is 500–800 photos in one scroll. The question a guest actually opens the link
with is narrower — "show me the ceremony", "where are we at the dinner" — and today the only answer
is to scroll past three hundred photos of getting ready. Chapters give the day its structure back:
a sticky row of chips at the top, a header over each part of the grid, one tap to the part you
want.

Nothing about this is wedding-specific in the code. A chapter is a title and a start; the presets
are wedding vocabulary because that is what this product delivers.

## The one rule

**A chapter is only a start.** It runs until the next chapter begins; the last one runs to the end
of the gallery; photos before the first chapter have no heading. There is no end to maintain, no
gap or overlap to validate, and nothing a photographer can get into an inconsistent state.

## The start is a timeline position, not a photo

`GalleryChapter.startTakenAt` + `startPhotoId` are the same `(takenAt, id)` pair the photo cursor
pages by (`src/lib/photo-cursor.ts`) — deliberately **not** a foreign key:

- **Deleting the photo a chapter was started on moves nothing.** The boundary stays at its place on
  the timeline and the chapter begins at the next photo. A relation would have had to cascade
  (losing the chapter) or null out (losing the boundary).
- **Photos added later fall into the right chapter by themselves** — a second shooter's card, a
  guest's upload, a forgotten batch — because their capture time puts them there.
- The photographer thinks "the ceremony starts at this shot", and that is exactly what is stored.

Known ceiling: a second camera whose clock was wrong interleaves in the wrong place. That is already
true of the whole timeline order (2026-08-25) and chapters neither fix nor worsen it.

Several chapters that end up reaching the same photo (their own photos deleted) collapse: only the
last one is shown. A chapter with no photos at all — every one deleted, or started past the last
photo — is dropped before it reaches the guest and marked "Prázdná" in the admin.

## Where it lives

| Concern                                         | File                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| Timeline order, presets, the client-facing type | `src/lib/gallery-chapters.ts`                    |
| Cutting the tile stream into chapters           | `groupByChapter` in `src/lib/gallery-grid.ts`    |
| Loading chapters (localized, with counts)       | `src/lib/shared-gallery.ts`                      |
| Chapter bar + header row                        | `src/components/chapter-nav.tsx`                 |
| Rows, jump, "which chapter am I in"             | `src/components/gallery-view.tsx`                |
| Writing chapters                                | `src/app/admin/chapter-actions.ts`               |
| Admin: list, rename, translate, remove          | `src/components/admin/gallery-chapter-panel.tsx` |
| Admin: timeline view, "Tady začíná kapitola"    | `src/app/admin/g/[id]/page.tsx` (`?timeline=1`)  |

## A chapter is never a photo

Same rule as promo cards (`docs/PROMO-CARDS.md`), for the same reason: the `photos` array that the
lightbox, arrow keys, selection, favourites, print marks and the ZIP manifest index into never sees
one. A header is a **row** in the virtualized grid, not a tile:

- each chapter's photos are run through `justifyRows` **on their own**, so a chapter always starts
  on a fresh row under its header instead of halfway through the previous chapter's last row;
- the header row has no photo in it, so `buildGridNavigation` yields an empty row and arrow keys
  step over it exactly as they step over a promo-only row;
- a promo tile sitting right before a chapter's first photo moves **under** that chapter's header,
  so a credit card never dangles alone at the end of the previous chapter.

The eager-priority image load goes to the first row of **photos**, not to row 0 — with a chapter
starting at the first photo, row 0 is a header.

## Placement happens in the browser

Each photo in the grid carries its `takenAt`, and `groupByChapter` places headers against the
photos actually loaded. The alternative — a server-computed "chapter starts at index N" — goes
stale the moment the grid refetches (a guest upload, the tab regaining focus) and puts a header one
photo off its boundary. A chapter whose start has not been reached by the loaded pages is simply not
in the grid yet; its header appears when its first photo does.

The per-chapter photo count ("84 fotek") **is** computed on the server, once per page load, and only
feeds the label. It can lag a reload behind a photo added while the page is open; placement never
depends on it.

## Jumping without loading what is skipped

The grid is virtualized by row (`useWindowVirtualizer`): only rows around the viewport mount, and an
image is only requested by a mounted tile. So a jump costs:

1. **Metadata up to the chapter's start** — row positions depend on every photo above, so pages are
   pulled until the header exists (the same loop the favourites filter uses). 60 photos per small
   JSON page; a 500-photo wedding is ~8 requests to reach its last chapter. The upgrade, if a
   2000-photo gallery ever makes that feel slow, is a `take` parameter on the photos route.
2. **An instant `scrollToIndex`, never a smooth one.** A smooth scroll would mount — and
   download — every row it passes. This is the load-bearing detail; `e2e/chapters.spec.ts` asserts
   that no photo from the middle of the gallery is requested on the way down.

`scrollPaddingStart` equals the sticky bar's height, so the header lands just under the bar, not
behind it. The header's `<h2>` then takes focus, so a screen reader lands on "Obřad" rather than
being left on the chip that was pressed.

## The chapter bar

Sticky at the top of the grid, horizontally scrollable, hidden when there are no chapters, while a
download selection is active (the selection toolbar takes that place), and in favourites-only mode
(the viewer's own shortlist has no chapters, as it has no promo). The chip of the chapter under the
bar is highlighted (`aria-current="location"`) and kept scrolled into view — derived from the
virtualizer's own scroll offset on every scroll render, no observer of its own. When the bar is
shown, the print summary pill moves below it rather than covering its chips. Blur only under a fine
pointer, like the print pill.

**Overflow.** When the chips do not fit, each side with more to show gets an arrow and a fade. The
arrows sit **beside** the scrolling row, never over it — the row narrows by their width, so no chip
can end up underneath a button (an overlaid arrow was tried first and hid the chip it covered). The
fade is a CSS mask, which is visual only and takes no clicks. An arrow pages the row by 80 % of its
width; a vertical mouse wheel over the bar scrolls it sideways until it reaches an end, then lets
the page scroll. The arrows are `aria-hidden` and out of the tab order: keyboard and screen-reader
users Tab through the chips, and a focused chip scrolls itself into view. `scroll-padding` matches
the row's padding — without it `snap-start` pulls the first chip flush to the edge and the row
opens already scrolled, with a "back" arrow showing.

## Links

Every chapter has a URL: the gallery's own link plus a hash, `…/g/{token}/{slug}#ceremony`. A hash
never reaches the server, so this adds nothing to what the token already exposes.

- **One anchor for every language.** `GalleryChapter.slug` is built once, at creation, and frozen —
  the same rule as `ShareLink.slug`: a rename never breaks a link already sent. It is English,
  because it has to be _one_ language and English is the app's fallback (docs/I18N.md) and the one
  any guest reads: a preset takes its English name (`ceremony`, `first-dance`), a custom title —
  which has no English yet when it is created — is transliterated to plain ASCII
  (`rozbijeni-talire`). A duplicate gets `-2`. Rows from before the column existed link by id.
- **Opening a link** with a known anchor jumps to that chapter exactly as a chip does. An anchor that
  names no chapter — deleted, emptied, mistyped — opens the **start of the gallery** and the hash is
  taken out of the URL, so a dead link is not passed on. Editing the hash by hand works the same.
- **The URL follows the reader.** As the chapter under the bar changes, the hash is _replaced_
  (never pushed — scrolling must not fill the back button with chapters). It is left alone at the
  very top of the page, so a gallery just opened keeps the URL it was opened with (which is also
  what lets an incoming `#ceremony` survive until the jump reads it), and while the lightbox is
  open, because the lightbox's own history entry is the current one then.
- **Chips are links** (`<a href="#ceremony">`): a plain click jumps, a long-press or right-click
  copies the chapter's URL, a modified click is left to the browser.
- **The admin** panel has a copy button per chapter: the newest live share link plus its anchor.

## Admin

Chapters are started **on a photo, in the timeline view** (`?timeline=1` — photos in the guests'
order, dividers where chapters begin), because that is where the photographer can see where the
ceremony actually starts. The default admin grid is sorted by favourites and would make "start
here" meaningless. The panel above lists the chapters with the photo each one currently begins with
and its count, for renaming, translating and removing. Removing a chapter hands its photos to the
chapter before it.

## Translations

`title` is the Czech original; `translations` follows `docs/I18N.md` §Content. **Presets translate
themselves**: picking "Obřad" from the list stores "Ceremony" / "Cérémonie" with it, and the
translation panel stays collapsed because there is nothing to review. A translation the
photographer typed always wins over a preset. Renaming a preset chapter to another title drops the
translations the _old_ preset supplied (they would otherwise survive as "Ceremony" under
"Přípravy") and keeps anything typed by hand.

## Not built (yet)

- **Suggesting boundaries** from gaps in capture time (a 20–30 min pause is usually a new part of
  the day). Saves clicks; manual first.
- **Downloading one chapter as a ZIP.**
- **A time on the header** ("Obřad · 14:02"). EXIF time carries no zone, so a wedding abroad would
  show the wrong hour.
