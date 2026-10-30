import { describe, expect, it, vi } from "vitest";
import { FACES_MODEL, type PhotoFaces } from "@/lib/social-video/faces";
import {
  inLanes,
  SCAN_BATCH,
  SCAN_PREFETCH,
  scanFaces,
  withRetry,
} from "@/lib/social-video/face-scan";

const none: PhotoFaces = { v: 1, model: FACES_MODEL, faces: [] };
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const blobOf = (id: string) => new Blob([id]);

describe("scanFaces", () => {
  it("searches every photo in order and saves them in batches", async () => {
    const searched: string[] = [];
    const saved: string[][] = [];
    const result = await scanFaces({
      photos: photos(SCAN_BATCH + 5),
      fetchPhoto: async (p) => blobOf(p.id),
      find: async (blob) => {
        searched.push(await blob.text());
        return none;
      },
      save: async (entries) => saved.push(entries.map((e) => e.photoId)),
    });
    expect(result).toEqual({ done: SCAN_BATCH + 5, total: SCAN_BATCH + 5, failed: 0 });
    expect(searched).toEqual(photos(SCAN_BATCH + 5).map((p) => p.id));
    expect(saved.map((b) => b.length)).toEqual([SCAN_BATCH, 5]);
  });

  it("fetches a few photos ahead, not the whole gallery at once", async () => {
    const fetched: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const scan = scanFaces({
      photos: photos(50),
      fetchPhoto: async (p) => {
        fetched.push(p.id);
        return blobOf(p.id);
      },
      find: async () => {
        await gate;
        return none;
      },
      save: async () => {},
    });
    await vi.waitFor(() => expect(fetched).toHaveLength(SCAN_PREFETCH + 1));
    release();
    await scan;
    expect(fetched).toHaveLength(50);
  });

  it("skips a photo that does not load or fails, and goes on", async () => {
    const saved: string[] = [];
    const result = await scanFaces({
      photos: photos(4),
      fetchPhoto: async (p) => {
        if (p.id === "p1") throw new Error("PHOTO_403");
        return blobOf(p.id);
      },
      find: async (blob) => {
        if ((await blob.text()) === "p2") throw new Error("DETECT");
        return none;
      },
      save: async (entries) => saved.push(...entries.map((e) => e.photoId)),
    });
    expect(result).toEqual({ done: 4, total: 4, failed: 2 });
    expect(saved).toEqual(["p0", "p3"]);
  });

  it("reports faces only once they are saved, so a failed save is searched again", async () => {
    const reported: string[] = [];
    const scan = scanFaces({
      photos: photos(3),
      fetchPhoto: async (p) => blobOf(p.id),
      find: async () => none,
      save: async () => {
        throw new Error("SESSION");
      },
      onSaved: (entries) => reported.push(...entries.map((e) => e.photoId)),
    });
    await expect(scan).rejects.toThrow("SESSION");
    expect(reported).toEqual([]);
  });

  it("stops when aborted and keeps what it found", async () => {
    const controller = new AbortController();
    const saved: string[] = [];
    const progress: number[] = [];
    const result = await scanFaces({
      photos: photos(10),
      fetchPhoto: async (p) => blobOf(p.id),
      find: async () => none,
      save: async (entries) => saved.push(...entries.map((e) => e.photoId)),
      onProgress: ({ done }) => {
        progress.push(done);
        if (done === 3) controller.abort();
      },
      signal: controller.signal,
    });
    expect(result.done).toBe(3);
    expect(saved).toEqual(["p0", "p1", "p2"]);
    expect(progress).toEqual([1, 2, 3]);
  });
});

describe("withRetry", () => {
  it("tries again after each delay until the work succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("NETWORK");
        return "saved";
      },
      { delays: [10, 20, 30], wait: async (ms) => void waits.push(ms) },
    );
    expect(result).toBe("saved");
    expect(waits).toEqual([10, 20]);
  });

  it("throws the last error once the delays run out", async () => {
    let calls = 0;
    const work = withRetry(
      async () => {
        calls += 1;
        throw new Error(`FAIL_${calls}`);
      },
      { delays: [1, 1], wait: async () => {} },
    );
    await expect(work).rejects.toThrow("FAIL_3");
  });

  it("does not wait on an error that waiting will not cure", async () => {
    const wait = vi.fn(async () => {});
    let calls = 0;
    const work = withRetry(
      async () => {
        calls += 1;
        throw new Error("STALE_DEPLOYMENT");
      },
      { delays: [1, 1], retryable: () => false, wait },
    );
    await expect(work).rejects.toThrow("STALE_DEPLOYMENT");
    expect(calls).toBe(1);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("inLanes", () => {
  it("does every item, never more than `lanes` at once", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    await inLanes(
      [0, 1, 2, 3, 4, 5, 6],
      3,
      async (item) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        done.push(item);
        running -= 1;
      },
      new AbortController(),
    );
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(most).toBe(3);
  });

  it("stops taking items after a failure, lets the others finish, then throws", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    let finishedOther = false;
    const run = inLanes(
      [0, 1, 2, 3, 4, 5],
      2,
      async (item) => {
        started.push(item);
        if (item === 0) throw new Error("SAVE");
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (item === 1) finishedOther = true;
      },
      controller,
    );
    await expect(run).rejects.toThrow("SAVE");
    expect(controller.signal.aborted).toBe(true);
    expect(finishedOther).toBe(true);
    expect(started).toEqual([0, 1]);
  });

  it("takes no more items once aborted", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await inLanes(
      [0, 1, 2, 3],
      1,
      async (item) => {
        started.push(item);
        if (item === 1) controller.abort();
      },
      controller,
    );
    expect(started).toEqual([0, 1]);
  });
});
