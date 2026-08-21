/**
 * A real justified layout: rows are packed greedily by aspect ratio and each
 * full row is scaled to fill the container width exactly, so every tile
 * shows the whole photo — no `object-cover` crop (docs/AUDIT.md §4.1).
 *
 * Not a Knuth-Plass line-breaking optimizer. The audit's own conclusion
 * (§6) is that a full optimizer is overkill for rows of a handful of
 * photos; a per-row greedy solve reads the same and is far simpler to get
 * right.
 */

export interface JustifiedItem<T> {
  item: T;
  width: number;
  height: number;
}

export interface JustifiedRow<T> {
  items: JustifiedItem<T>[];
  height: number;
  /** The final row, packed but never stretched to fill the width — matches
   * the intent of not exaggerating a half-empty last row. */
  partial: boolean;
}

/** `aspect` must be `width / height`, already known (Photo.width/height are
 * captured at upload — see `docs/AUDIT.md` §2). */
export function justifyRows<T>(
  items: readonly { item: T; aspect: number }[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number,
): JustifiedRow<T>[] {
  if (containerWidth <= 0 || items.length === 0) return [];

  const rows: JustifiedRow<T>[] = [];
  let row: { item: T; aspect: number }[] = [];
  let aspectSum = 0;

  for (const entry of items) {
    row.push(entry);
    aspectSum += entry.aspect;

    const widthAtTarget = aspectSum * targetRowHeight + gap * (row.length - 1);
    if (widthAtTarget >= containerWidth) {
      const scale = (containerWidth - gap * (row.length - 1)) / (aspectSum * targetRowHeight);
      const height = targetRowHeight * scale;
      rows.push({
        items: row.map((r) => ({ item: r.item, width: r.aspect * height, height })),
        height,
        partial: false,
      });
      row = [];
      aspectSum = 0;
    }
  }

  if (row.length > 0) {
    rows.push({
      items: row.map((r) => ({
        item: r.item,
        width: r.aspect * targetRowHeight,
        height: targetRowHeight,
      })),
      height: targetRowHeight,
      partial: true,
    });
  }

  return rows;
}
