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

/** A row back this soon leaves no order to see: the rest of the screen goes with it. */
const QUICK_ROW_MS = 1_000;
/** Nothing drawn for this long is a stalled request: the next row goes beside it. */
const STALLED_MS = 5_000;

export function createScreenGate(): ScreenGate {
  const waiting = new Map<string, number>();
  const listeners = new Set<() => void>();
  let opened = false;
  let turn = -1;
  let turnedAt = 0;
  let stall: ReturnType<typeof setTimeout> | undefined;

  const moveTo = (next: number) => {
    if (next === turn) return;
    turn = next;
    turnedAt = Date.now();
    for (const listener of listeners) listener();
  };
  const update = () => {
    if (!opened) return;
    const rows = [...waiting.values()];
    // Infinity with no row left.
    const top = Math.min(...rows);
    // On only once nothing up to it is left. A row coming on screen above it
    // (scrolling up) is within it and goes at once, and rows let go keep what
    // they have downloaded.
    if (turn === Infinity || top > turn) {
      const quick = turn >= 0 && turn !== Infinity && Date.now() - turnedAt < QUICK_ROW_MS;
      moveTo(quick && rows.length > 0 ? Math.max(...rows) : top);
    }
    clearTimeout(stall);
    if (rows.some((row) => row > turn)) {
      stall = setTimeout(() => {
        moveTo(Math.min(...[...waiting.values()].filter((row) => row > turn)));
        update();
      }, STALLED_MS);
    }
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
