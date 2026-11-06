/**
 * The grid's screen first, from the top (docs/GALLERY-LOADING.md): the tiles on
 * screen wait here until their image has drawn, a row fetches once the rows
 * above it on screen have, and the tiles off screen — the rows the virtualizer
 * keeps mounted around it — fetch theirs only once none is left. On a slow link
 * they would otherwise share it, and the CDN answers same-priority images in an
 * order of its own: the rows filled in at random, the screen late.
 *
 * Shut until `open()`: the tiles on screen register in their effects, which run
 * after the first render that could otherwise let every tile through.
 */
export interface ScreenGate {
  subscribe: (listener: () => void) => () => void;
  /** Rows up to this one may fetch: -1 until opened, Infinity with nothing on screen still loading. */
  turn: () => number;
  wait: (id: string, row: number) => void;
  done: (id: string) => void;
  open: () => void;
}

export function createScreenGate(): ScreenGate {
  const waiting = new Map<string, number>();
  const listeners = new Set<() => void>();
  let opened = false;
  let turn = -1;
  const update = () => {
    if (!opened) return;
    const rows = [...waiting.values()];
    let next = turn;
    if (rows.length === 0) next = Infinity;
    // On only once nothing up to it is left. A row coming on screen above it
    // (scrolling up) is within it and goes at once, and the turn does not move
    // back: rows already let go keep what they have downloaded.
    else if (turn === Infinity || !rows.some((row) => row <= turn)) next = Math.min(...rows);
    if (next === turn) return;
    turn = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    turn: () => turn,
    wait: (id, row) => {
      waiting.set(id, row);
      update();
    },
    done: (id) => {
      waiting.delete(id);
      update();
    },
    open: () => {
      opened = true;
      update();
    },
  };
}

/**
 * Whether a row may start fetching at this turn. On screen, only when its turn
 * has come: at Infinity the tiles of a row just coming on screen have not
 * registered yet, and would all go at once. Off screen, once nothing on it is
 * left.
 */
export function rowMayFetch(turn: number, row: number, onScreen: boolean): boolean {
  return onScreen ? turn !== Infinity && row <= turn : turn === Infinity;
}
