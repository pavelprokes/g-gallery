/**
 * FILE_NAME_GUESTS_BY_TIME order (docs/PHOTO-ORDER.md §Guests woven in):
 * the photographer's photos in file-name order — Lightroom's — with guests'
 * photos placed among them by when they were taken.
 *
 * Both have to live on one axis for a keyset cursor, so each photo gets a
 * time, `wovenAt`:
 *
 *   - a guest's photo: its own capture time;
 *   - the photographer's: the closest sequence to their capture times that
 *     rises in file-name order — an isotonic regression, under absolute error
 *     so it is robust (each pooled run takes its *median*). Where the clocks
 *     agree with the export nothing moves. A body whose clock ran behind or
 *     ahead, for one photo or a run of them, is pooled with its neighbours
 *     until the order holds again — and only there: the error stays local
 *     instead of carrying every later photo along with it.
 *
 * Then +1 ms steps break the ties inside a pooled run, so the times rise
 * strictly in file-name order and the cursor never has to fall back on ids.
 *
 * Pure and client-safe; `refreshWovenOrder` writes the result.
 */

export interface WeaveInput {
  id: string;
  source: "OWNER" | "GUEST";
  fileOrderKey: string;
  /** Capture time, or upload time where there is none. */
  capturedAt: Date;
}

export function weaveTimes(photos: readonly WeaveInput[]): Map<string, Date> {
  const woven = new Map<string, Date>();

  const owners = photos
    .filter((photo) => photo.source !== "GUEST")
    .toSorted((a, b) =>
      a.fileOrderKey !== b.fileOrderKey
        ? a.fileOrderKey < b.fileOrderKey
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    );
  const fitted = isotonicMedian(owners.map((photo) => photo.capturedAt.getTime()));

  let previous = -Infinity;
  owners.forEach((photo, i) => {
    // Whole milliseconds: that is what the column stores.
    const at = Math.max(Math.floor(fitted[i]!), previous + 1);
    woven.set(photo.id, new Date(at));
    previous = at;
  });

  for (const photo of photos) {
    if (photo.source === "GUEST") woven.set(photo.id, photo.capturedAt);
  }
  return woven;
}

/**
 * Non-decreasing fit to `values` minimising absolute error: pool adjacent
 * violators, each pool valued at its (lower) median. O(n² log n) in the worst
 * case, which for a gallery of a thousand photos is nothing.
 */
export function isotonicMedian(values: readonly number[]): number[] {
  const pools: { members: number[]; value: number; size: number }[] = [];
  for (const value of values) {
    pools.push({ members: [value], value, size: 1 });
    while (pools.length > 1 && pools.at(-2)!.value > pools.at(-1)!.value) {
      const last = pools.pop()!;
      const into = pools.at(-1)!;
      into.members = [...into.members, ...last.members].sort((a, b) => a - b);
      into.size = into.members.length;
      into.value = into.members[(into.size - 1) >> 1]!;
    }
  }
  return pools.flatMap((pool) => Array<number>(pool.size).fill(pool.value));
}
