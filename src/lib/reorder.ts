// Pure helpers behind drag-and-drop reordering in the admin
// (src/components/admin/sortable-strip.tsx).

/** `list` with the item at `from` moved to `to`; the others keep their order. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

/**
 * Which slot a pointer at (x, y) is over: the item whose centre is nearest,
 * row first — in a wrapping grid the row decides, then the column. -1 for no
 * items.
 */
export function slotAt(
  x: number,
  y: number,
  rects: readonly { left: number; top: number; width: number; height: number }[],
): number {
  let best = -1;
  let bestRow = Infinity;
  let bestCol = Infinity;
  rects.forEach((r, i) => {
    // Anywhere within a row's height counts as on that row.
    const dy = Math.abs(y - (r.top + r.height / 2));
    const row = dy > r.height / 2 ? dy : 0;
    const col = Math.abs(x - (r.left + r.width / 2));
    if (row < bestRow || (row === bestRow && col < bestCol)) {
      best = i;
      bestRow = row;
      bestCol = col;
    }
  });
  return best;
}
