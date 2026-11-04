import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isThumbhash } from "../src/lib/thumbhash";
import { fillBatch, type BackfillRow, type PhotoWriter } from "./backfill-thumbhash";

const row = (id: string, thumbObjectKey: string | null = null): BackfillRow => ({
  id,
  objectKey: `g/${id}.jpg`,
  thumbObjectKey,
  fileName: `${id}.jpg`,
});

function writer(count = 1) {
  const updateMany = vi.fn<PhotoWriter["updateMany"]>(async () => ({ count }));
  return { updateMany };
}

describe("fillBatch", () => {
  let jpeg: Buffer;
  const served = new Map<string, number>();

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.test");
    vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "none");
    jpeg = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#c08040" },
    })
      .jpeg()
      .toBuffer();
  });

  /** Answers with `jpeg`, or the status `served` holds for that key. */
  function stubCdn() {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const key = new URL(url).pathname.slice(1);
        fetched.push(key);
        const status = served.get(key);
        return status ? new Response(null, { status }) : new Response(new Uint8Array(jpeg));
      }),
    );
    return fetched;
  }

  afterEach(() => {
    served.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes only if the row still holds the picture it read, and no hash yet", async () => {
    stubCdn();
    const db = writer();
    await fillBatch([row("a")], db);
    const { where, data } = db.updateMany.mock.calls[0]![0];
    expect(where).toEqual({ id: "a", objectKey: "g/a.jpg", thumbhash: null });
    expect(isThumbhash(data.thumbhash)).toBe(true);
    expect(data.placeholder).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("counts a row replaced meanwhile apart from one it filled", async () => {
    stubCdn();
    expect(await fillBatch([row("a")], writer(0))).toEqual({ filled: 0, changed: 1, failed: 0 });
  });

  it("falls back to the original when the thumbnail's object is gone", async () => {
    const fetched = stubCdn();
    served.set("g/a.thumb.webp", 404);
    const result = await fillBatch([row("a", "g/a.thumb.webp")], writer());
    expect(fetched).toEqual(["g/a.thumb.webp", "g/a.jpg"]);
    expect(result.filled).toBe(1);
  });

  it("spends no transformation when the thumbnail failed for another reason", async () => {
    const fetched = stubCdn();
    served.set("g/a.thumb.webp", 503);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await fillBatch([row("a", "g/a.thumb.webp")], writer());
    expect(fetched).toEqual(["g/a.thumb.webp"]);
    expect(result.failed).toBe(1);
    expect(warn.mock.calls[0]![0]).toContain("HTTP 503");
  });

  it("goes on past a photo it cannot read and a write that fails, saying why", async () => {
    stubCdn();
    served.set("g/gone.jpg", 404);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = writer();
    db.updateMany.mockRejectedValueOnce(new Error("connection lost"));
    const result = await fillBatch([row("a"), row("gone"), row("b"), row("c")], db);
    expect(result).toEqual({ filled: 2, changed: 0, failed: 2 });
    const reasons = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reasons).toContain("HTTP 404");
    expect(reasons).toContain("connection lost");
  });
});
