import { describe, expect, it, vi } from "vitest";
import { FACES_MODEL, type PhotoFaces } from "@/lib/social-video/faces";
import { SCAN_BATCH, SCAN_PREFETCH, scanFaces } from "@/lib/social-video/face-scan";

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
