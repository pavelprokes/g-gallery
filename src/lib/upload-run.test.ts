import { describe, expect, it, vi } from "vitest";
import { pendingQuery, runUploads } from "./upload-run";

// The thumbnail itself is covered in thumbnail.test.ts; what matters here is
// that the owner/guest split this module already carries reaches it, because
// the two profiles produce different pixels (1024/0.65 vs 512/0.72).
const makeThumbnail = vi.hoisted(() =>
  // Arguments are typed, not omitted, so `mock.calls[0][1]` is the profile
  // rather than an index into an empty tuple.
  vi.fn(async (source: Blob, profile?: "owner" | "guest") => {
    void source;
    void profile;
    return null;
  }),
);
vi.mock("@/lib/thumbnail", () => ({ makeThumbnail }));

describe("pendingQuery", () => {
  it("identifies the owner by gallery", () => {
    expect(pendingQuery({ kind: "owner", galleryId: "gal_1" })).toBe("galleryId=gal_1");
  });

  it("identifies a guest by share token and viewer", () => {
    const query = new URLSearchParams(
      pendingQuery({ kind: "guest", shareToken: "tok", anonKey: "abc" }),
    );
    expect(query.get("shareToken")).toBe("tok");
    expect(query.get("anonKey")).toBe("abc");
  });

  it("omits the viewer entirely when the guest opted out", () => {
    const query = pendingQuery({ kind: "guest", shareToken: "tok", anonKey: null });
    expect(query).toBe("shareToken=tok");
    expect(query).not.toContain("anonKey");
  });

  it("escapes token characters that are legal in a token but not in a query", () => {
    // Share tokens are base64url, which includes '-' and '_', but a label or a
    // future token format must not be able to inject a second parameter.
    const query = new URLSearchParams(
      pendingQuery({ kind: "guest", shareToken: "a&galleryId=gal_1", anonKey: null }),
    );
    expect(query.get("shareToken")).toBe("a&galleryId=gal_1");
    expect(query.get("galleryId")).toBeNull();
  });
});

describe("runUploads — unsupported files", () => {
  function file(name: string, type: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
  }

  it("skips unsupported files without failing the rest of the batch", async () => {
    const presigned = {
      photoId: "p1",
      objectKey: "k",
      url: "https://r2.example/put",
      headers: {},
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.includes("/api/uploads/presign")) {
        return new Response(JSON.stringify({ uploads: [presigned] }), { status: 200 });
      }
      if (url.includes("/api/uploads/confirm")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(null, { status: 200, headers: { etag: '"abc"' } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const states: Record<number, string> = {};
    const skips: { reason?: string; count: number }[] = [];

    await runUploads({
      files: [file("IMG_1.HEIC", "image/heic"), file("ok.jpg", "image/jpeg")],
      credentials: { kind: "guest", shareToken: "tok", anonKey: null },
      resumeIds: [undefined, undefined],
      onItem: (index, patch) => {
        states[index] = patch.state;
      },
      onFatal: () => {
        throw new Error("must not be fatal — the JPEG still uploads");
      },
      onSkipped: (rejection, count) => skips.push({ reason: rejection.detail.reason, count }),
    });

    expect(states[0]).toBe("error");
    expect(states[1]).toBe("done");
    expect(skips).toEqual([{ reason: "heic", count: 1 }]);

    // The HEIC never reached the server: presign was called with the JPEG only.
    const presignCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/uploads/presign"),
    );
    expect(presignCalls).toHaveLength(1);
    const body = JSON.parse(String(presignCalls[0]![1]?.body));
    expect(body.files.map((f: { fileName: string }) => f.fileName)).toEqual(["ok.jpg"]);

    vi.unstubAllGlobals();
  });

  it("never calls the server when nothing is uploadable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let skippedCount = 0;
    await runUploads({
      files: [file("a.HEIC", "image/heic"), file("b.mov", "video/quicktime")],
      credentials: { kind: "guest", shareToken: "tok", anonKey: null },
      resumeIds: [undefined, undefined],
      onItem: () => undefined,
      onFatal: () => undefined,
      onSkipped: (_rejection, count) => {
        skippedCount = count;
      },
    });

    expect(skippedCount).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("runUploads — thumbnail profile", () => {
  function jpeg(name: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
  }

  async function uploadAs(credentials: Parameters<typeof runUploads>[0]["credentials"]) {
    makeThumbnail.mockClear();
    const presigned = {
      photoId: "p1",
      objectKey: "galleries/g/p1.jpg",
      url: "https://r2.example/put",
      headers: {},
      thumbTargets: { webp: { url: "https://r2.example/thumb", headers: {} } },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/uploads/presign")) {
          return new Response(JSON.stringify({ uploads: [presigned] }), { status: 200 });
        }
        if (url.includes("/api/uploads/confirm")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(null, { status: 200, headers: { etag: '"abc"' } });
      }),
    );

    try {
      await runUploads({
        files: [jpeg("ok.jpg")],
        credentials,
        resumeIds: [undefined],
        onItem: () => undefined,
        onFatal: () => undefined,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("asks for the owner profile when the photographer uploads", async () => {
    await uploadAs({ kind: "owner", galleryId: "gal_1" });
    expect(makeThumbnail).toHaveBeenCalledTimes(1);
    expect(makeThumbnail.mock.calls[0]![1]).toBe("owner");
  });

  it("asks for the guest profile when a share token authorises the upload", async () => {
    await uploadAs({ kind: "guest", shareToken: "tok", anonKey: "abc" });
    expect(makeThumbnail).toHaveBeenCalledTimes(1);
    expect(makeThumbnail.mock.calls[0]![1]).toBe("guest");
  });
});
