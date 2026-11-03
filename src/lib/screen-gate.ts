/**
 * The grid's screen first (docs/GALLERY-LOADING.md): the tiles on screen wait
 * here until their image has drawn, and the tiles off screen — the rows the
 * virtualizer keeps mounted around it — fetch theirs only once none is left.
 * On a slow link they would otherwise share it with the screen the viewer is
 * looking at, every image arriving late instead of these arriving first.
 *
 * Shut until `open()`: the tiles on screen register in their effects, which run
 * after the first render that could otherwise let every tile through.
 */
export interface ScreenGate {
  subscribe: (listener: () => void) => () => void;
  /** Opened, and nothing on screen still loading. */
  isClear: () => boolean;
  wait: (id: string) => void;
  done: (id: string) => void;
  open: () => void;
}

export function createScreenGate(): ScreenGate {
  const waiting = new Set<string>();
  const listeners = new Set<() => void>();
  let opened = false;
  let clear = false;
  const update = () => {
    const next = opened && waiting.size === 0;
    if (next === clear) return;
    clear = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isClear: () => clear,
    wait: (id) => {
      waiting.add(id);
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
