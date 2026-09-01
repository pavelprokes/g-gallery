/**
 * Turning a list of photos plus a list of promo placements into the stream of
 * tiles the justified layout actually packs.
 *
 * This module exists so that exactly one file knows a grid can hold something
 * that is not a photo. Everywhere else — the lightbox, arrow-key navigation,
 * selection, favourites, print marks, the ZIP manifest — keeps working on the
 * plain `photos` array and its plain 0-based index, which is why none of them
 * needed a promo-shaped special case. A promo tile is a *layout* participant
 * and nothing else:
 *
 *   - it is never reachable by opening a photo (there is no photo index for it)
 *   - arrow keys step over it (`photoIndicesByRow` lists photos only)
 *   - it can never be selected, downloaded, favourited or zipped
 *
 * See `docs/PROMO-CARDS.md` for why it works this way rather than by inserting
 * a fake photo into the stream.
 */

import { type GalleryPromo, promoInsertIndex } from "@/lib/promo-card";

export type GridEntry<P> =
  | {
      kind: "photo";
      photo: P;
      /** Index into the caller's own `photos` array — the only index any other
       * part of the gallery uses. Stable regardless of how many promos sit
       * above it. */
      photoIndex: number;
    }
  | { kind: "promo"; promo: GalleryPromo };

/**
 * Interleaves promo placements into the photo stream at their slots.
 *
 * Slots are resolved against the *full* gallery, not the pages loaded so far,
 * so a card at slot 5 is the 5th tile from the very first paint and does not
 * jump when the next page arrives.
 *
 * Two promos landing on the same index keep their relative order by slot, then
 * by id — deterministic, so the grid does not reshuffle between renders.
 */
export function buildGridEntries<P>(
  photos: readonly P[],
  promos: readonly GalleryPromo[],
): GridEntry<P>[] {
  if (promos.length === 0) {
    return photos.map((photo, photoIndex) => ({ kind: "photo", photo, photoIndex }));
  }

  const placed = [...promos]
    .map((promo) => ({ promo, at: promoInsertIndex(promo.slot, photos.length) }))
    .sort(
      (a, b) => a.at - b.at || a.promo.slot - b.promo.slot || (a.promo.id < b.promo.id ? -1 : 1),
    );

  const entries: GridEntry<P>[] = [];
  let next = 0;

  for (let photoIndex = 0; photoIndex <= photos.length; photoIndex += 1) {
    while (next < placed.length && placed[next]!.at === photoIndex) {
      entries.push({ kind: "promo", promo: placed[next]!.promo });
      next += 1;
    }
    // The final pass exists only to flush promos clamped to the very end;
    // there is no photo at `photos.length`.
    if (photoIndex < photos.length) {
      entries.push({ kind: "photo", photo: photos[photoIndex]!, photoIndex });
    }
  }

  return entries;
}

/**
 * A stable React key for a grid entry. Promo keys are namespaced so a promo
 * placement id can never collide with a photo id.
 */
export function gridEntryKey<P>(entry: GridEntry<P>, photoId: (photo: P) => string): string {
  return entry.kind === "promo" ? `promo:${entry.promo.id}` : `photo:${photoId(entry.photo)}`;
}

export interface GridNavigation {
  /** Row index holding a given photo index. */
  rowIndexForPhoto: Map<number, number>;
  /** Photo indices in each row, left to right, promos omitted. A row that is
   * nothing but a promo yields an empty array — arrow navigation skips it
   * rather than dead-ending there. */
  photoIndicesByRow: number[][];
}

/**
 * Builds the maps arrow-key navigation needs from already-justified rows.
 *
 * Deliberately promo-blind: ArrowUp/ArrowDown move between *photos* in
 * adjacent rows, and a promo occupying a column simply is not a landing spot.
 * That keeps the roving tabindex over photos only, which is what makes the
 * promo's own link an ordinary Tab stop instead of a hole in the grid.
 */
export function buildGridNavigation<P>(
  rows: readonly { items: { item: GridEntry<P> }[] }[],
): GridNavigation {
  const rowIndexForPhoto = new Map<number, number>();
  const photoIndicesByRow: number[][] = [];

  rows.forEach((row, rowIndex) => {
    const indices: number[] = [];
    for (const entry of row.items) {
      if (entry.item.kind !== "photo") continue;
      indices.push(entry.item.photoIndex);
      rowIndexForPhoto.set(entry.item.photoIndex, rowIndex);
    }
    photoIndicesByRow.push(indices);
  });

  return { rowIndexForPhoto, photoIndicesByRow };
}

/**
 * The photo index one row up or down from `photoIndex`, keeping the visual
 * column where possible. `null` when there is nowhere to go.
 *
 * Rows holding nothing but a promo are stepped over rather than treated as the
 * edge of the grid — otherwise a card that happened to fill a phone row on its
 * own would make everything below it unreachable by keyboard.
 */
export function photoInAdjacentRow(
  nav: GridNavigation,
  photoIndex: number,
  direction: 1 | -1,
): number | null {
  const rowIndex = nav.rowIndexForPhoto.get(photoIndex);
  if (rowIndex === undefined) return null;

  const column = nav.photoIndicesByRow[rowIndex]?.indexOf(photoIndex) ?? -1;
  if (column < 0) return null;

  for (
    let target = rowIndex + direction;
    target >= 0 && target < nav.photoIndicesByRow.length;
    target += direction
  ) {
    const candidates = nav.photoIndicesByRow[target]!;
    if (candidates.length === 0) continue;
    return candidates[Math.min(column, candidates.length - 1)]!;
  }

  return null;
}
