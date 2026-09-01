# Promo cards — the photographer's credit tile in the grid

Adopted 2026-09-01. Authority for anything that puts a non-photo tile into the gallery grid.

## Why

Six of the eight review personas, independently and without seeing each other's notes, reached the
same finding: **the photographer is invisible inside their own gallery.** `SiteFooterIdentity`
exists, but it sits at 12 px under an infinite scroll of 500 photos, so nobody reaches it. A guest
who falls in love with the photos at someone else's wedding — the single highest-intent referral
this product will ever see — has no way to learn who took them.

A promo card is one tile inside the grid that says who shot the wedding and links to their site.

## The one rule

**A promo is never a photo.** It is inserted into the _layout_ stream only.

The `photos` array — the one the lightbox, arrow-key navigation, selection, favourites, print
marks and the ZIP manifest all index into — never contains one. That is the entire design, and it
is why none of those subsystems needed a special case:

- it cannot be opened (no photo index exists for it)
- arrow keys step over it (`photoIndicesByRow` lists photos only)
- it cannot be selected, downloaded, favourited, marked for print, or zipped
- it does not shift the index of any photo around it

The alternative — inserting a synthetic photo row and filtering it back out at eleven call sites —
is the version of this feature that breaks six months from now, in the one call site somebody
forgot.

## Where it lives

| Concern                                        | File                                           |
| ---------------------------------------------- | ---------------------------------------------- |
| Slot maths, URL safety, the client-facing type | `src/lib/promo-card.ts`                        |
| Interleaving + keyboard-navigation maps        | `src/lib/gallery-grid.ts`                      |
| The tile itself                                | `src/components/promo-tile.tsx`                |
| Loading placements for a viewer                | `src/lib/shared-gallery.ts`                    |
| Writing cards and placements                   | `src/app/admin/promo-actions.ts`               |
| Admin: the card library                        | `src/app/admin/promo/page.tsx`                 |
| Admin: placing one in a gallery                | `src/components/admin/gallery-promo-panel.tsx` |

## Data model

Two tables, because content and placement have different lifetimes:

- **`PromoCard`** — owner-level, reusable. Write "Fotil Pavel Prokeš" once; fixing a typo or a
  moved URL fixes every gallery at once, instead of needing every delivered gallery re-edited.
- **`GalleryPromo`** — one card placed in one gallery, with a `slot` and an `enabled` switch. The
  slot belongs to the gallery, not to the card: the same card sits 5th in a 60-photo gallery and
  5th in an 800-photo one, and either can move without touching the other.

`@@unique([galleryId, promoCardId])` — placing the same card twice in one gallery is always a
mistake. Two _different_ cards in one gallery stays legal, and the rendering path is already
N-aware, though the admin is built around the common case of one.

## Slots are 1-based

`slot = 5` means "be the 5th tile in the grid", so what used to be the 5th photo becomes the 6th.
That is the sentence the owner is thinking in, and a 0-based number in an admin field is a bug
generator. The conversion to a 0-based insert index happens in exactly one place,
`promoInsertIndex`, which is unit-tested.

Slots are resolved against the **whole gallery**, not the pages loaded so far, so a card at slot 5
is the 5th tile from the first paint and does not jump when the next page arrives. Placements are
therefore sent once with the page rather than per photo page.

A slot past the end of the gallery **clamps to the end** rather than dropping the tile: a card is
very often placed while the gallery is still uploading, and a tile that silently vanishes below a
threshold is the kind of thing nobody notices until a client asks where the credit went.

## Layout

The tile packs as a **landscape frame** (`PROMO_ASPECT = 1.5`) — the same ratio as
`FALLBACK_ASPECT` and as every full-frame body held sideways. A row containing one therefore packs
exactly as it would have with a photo in that place: no bespoke row height, no gap in the rhythm.

Type scales with **container queries** (`cqi`), not viewport ones. The tile is as wide as the
justified row made it, which depends on the aspect ratios of the photos sharing that row — not on
the viewport. The same phone renders this tile at 190 px in one gallery and 300 px in another.
`cqi` resolves against the tile's own inline size, so the headline is always right _for the box it
is in_, with no measurement, no JS and no resize listener. `clamp()` holds the extremes.

Below ~240 px the body text is hidden and only the eyebrow, headline and link remain — which is
why the admin form warns that the headline must stand on its own.

## Deliberately text-only

No image. The tile shares a row with actual photographs, and a second picture competing with them
is exactly what makes a gallery look like a website with ads in it. Three fixed themes rather than
a colour picker, all built from the existing brand tokens, each above 7:1 for the headline.

## Safety

`ctaUrl` is a stored string rendered as an `href` into pages held by people who are not its author.
It is validated as absolute `http(s)` on write (`promo-actions.ts`), filtered again on read
(`shared-gallery.ts`), and checked a third time at render (`promo-tile.tsx`) — because a row can
predate a validation rule. Dropping the tile is the safe failure; the grid simply has one fewer
entry.

The link carries `rel="noopener noreferrer"`. `noreferrer` is the load-bearing half: without it the
share token in the URL would reach the photographer's own analytics as a `Referer`, against
invariant #7.

## Accessibility

The card is a plain **Tab stop**, not part of the roving tabindex — which covers photos only. Arrow
keys move between photos and step over it; a row that is nothing but a promo is skipped entirely
(`photoInAdjacentRow`), or everything below it would be unreachable by keyboard.

## Not shown in favourites-only mode

That view is the viewer's own shortlist. A credit card in the middle of it is neither theirs nor a
favourite.

## Testing

`src/lib/promo-card.test.ts` and `src/lib/gallery-grid.test.ts` cover the slot maths, URL safety,
interleaving, key namespacing and the keyboard-navigation maps (27 cases).

`e2e/promo-tile.spec.ts` covers the inertness claims in a real browser. The seed places a card at
slot 5 in the **same gallery `gallery-view.spec.ts` uses**, on purpose: that file's existing
assertions — tile count, lightbox `1 / N`, roving tabindex, shift-click ranges — then double as
proof that a non-photo tile in the grid disturbs none of them.

## Not built (deliberate)

- **Click tracking.** Worth having — the photographer should know whether the card works — but it
  means an `ActivityType` enum value and a beacon path, and it is not needed to ship the tile.
- **An "end of gallery" card.** A different placement with a different job (a closing CTA rather
  than a credit); the model already supports it via a large slot, but nothing in the UI offers it.
- **Per-gallery content overrides.** The card is reusable by design; if one wedding needs different
  words, write a second card.
