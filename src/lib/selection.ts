/**
 * Photo selection for bulk download, modelled on Google Photos: a circular
 * checkbox on each tile, shift-click to take a run, a bar that appears once
 * something is selected.
 *
 * Kept out of the component so the range and toggle rules — the parts that are
 * fiddly and easy to get subtly wrong — are testable without a DOM.
 */

export interface SelectionState {
  ids: ReadonlySet<string>;
  /** Where the next shift-click measures from. Null until something is picked. */
  anchorIndex: number | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), anchorIndex: null };

/**
 * Toggles one photo and remembers it as the anchor.
 *
 * The anchor moves even when deselecting, matching Google Photos: the next
 * shift-click reaches from the last tile you touched, not from the last one
 * you added.
 */
export function toggleOne(state: SelectionState, index: number, id: string): SelectionState {
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchorIndex: index };
}

/**
 * Shift-click: adds the run between the anchor and `index` inclusive.
 *
 * A range only ever ADDS. Making it toggle each member would mean a shift-click
 * across a partly-selected run deselects half of it, which is never what the
 * gesture is asking for.
 */
export function selectRange(
  state: SelectionState,
  index: number,
  idAt: (i: number) => string | undefined,
): SelectionState {
  // No anchor yet — a shift-click with nothing to measure from is a plain click.
  if (state.anchorIndex === null) {
    const id = idAt(index);
    return id ? toggleOne(state, index, id) : state;
  }

  const from = Math.min(state.anchorIndex, index);
  const to = Math.max(state.anchorIndex, index);

  const ids = new Set(state.ids);
  for (let i = from; i <= to; i += 1) {
    const id = idAt(i);
    if (id) ids.add(id);
  }
  // The anchor stays put so repeated shift-clicks grow and shrink one range.
  return { ids, anchorIndex: state.anchorIndex };
}

export function selectAll(allIds: readonly string[]): SelectionState {
  return { ids: new Set(allIds), anchorIndex: null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** Selection order follows gallery order, never click order — so does the ZIP. */
export function selectedInOrder(state: SelectionState, allIds: readonly string[]): string[] {
  return allIds.filter((id) => state.ids.has(id));
}

export function isAllSelected(state: SelectionState, allIds: readonly string[]): boolean {
  return allIds.length > 0 && state.ids.size === allIds.length;
}
