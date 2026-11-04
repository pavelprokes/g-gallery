import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANCELLED, pendingQuery, runUploads } from "./upload-run";

/**
 * The original goes up by XHR (for upload progress), so R2 is faked at that
 * level: every PUT reports its full size once and answers 200 with an ETag on
 * the next microtask, unless `hold` keeps it open to observe concurrency.
 */
class FakeXHR {
  static open = 0;
  static peak = 0;
  static hold: Promise<void> | null = null;
  /** Status for the next PUTs, consumed one per request; 200 once empty. */
  static statuses: number[] = [];
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private finished = false;
  open() {}
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return name.toLowerCase() === "etag" ? '"abc"' : null;
  }
  send(body: Blob) {
    FakeXHR.open += 1;
    FakeXHR.peak = Math.max(FakeXHR.peak, FakeXHR.open);
    void (FakeXHR.hold ?? Promise.resolve()).then(() => {
      if (this.finished) return;
      this.finished = true;
      FakeXHR.open -= 1;
      this.upload.onprogress?.({ loaded: body.size });
      this.status = FakeXHR.statuses.shift() ?? 200;
      this.onload?.();
    });
  }
  abort() {
    if (this.finished) return;
    this.finished = true;
    FakeXHR.open -= 1;
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXHR.open = 0;
  FakeXHR.peak = 0;
  FakeXHR.hold = null;
  FakeXHR.statuses = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

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

describe("runUploads — guest name", () => {
  it("sends the volunteered name with presign only, never with confirm", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.includes("/api/uploads/presign")) {
        return new Response(
          JSON.stringify({
            uploads: [
              { photoId: "p1", objectKey: "k", url: "https://r2.example/put", headers: {} },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/uploads/confirm")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(null, { status: 200, headers: { etag: '"abc"' } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runUploads({
      files: [new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" })],
      credentials: { kind: "guest", shareToken: "tok", anonKey: "abc", displayName: "Petra" },
      resumeIds: [undefined],
      onItem: () => undefined,
      onFatal: () => undefined,
      onSkipped: () => undefined,
    });

    const bodyOf = (path: string) =>
      JSON.parse(
        String(fetchMock.mock.calls.find((call) => String(call[0]).includes(path))![1]?.body),
      );
    expect(bodyOf("/api/uploads/presign").displayName).toBe("Petra");
    expect(bodyOf("/api/uploads/confirm")).not.toHaveProperty("displayName");

    vi.unstubAllGlobals();
  });
});

describe("runUploads — rolling queue", () => {
  function jpegs(count: number): File[] {
    return Array.from(
      { length: count },
      (_, i) => new File([new Uint8Array(100 + i)], `IMG_${i}.jpg`, { type: "image/jpeg" }),
    );
  }

  function stubServer(presignGate?: Promise<void>) {
    let photo = 0;
    const presignSizes: number[] = [];
    const resumeIdsSeen: (string | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/uploads/presign")) {
          if (presignGate) await presignGate;
          if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
          const files = JSON.parse(String(init?.body)).files as { resumePhotoId?: string }[];
          presignSizes.push(files.length);
          files.forEach((f) => resumeIdsSeen.push(f.resumePhotoId));
          const uploads = files.map((f) => ({
            photoId: f.resumePhotoId ?? `p${++photo}`,
            objectKey: "k",
            url: "https://r2.example/put",
            headers: {},
          }));
          return new Response(JSON.stringify({ uploads }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    return Object.assign(presignSizes, { resumeIdsSeen });
  }

  it("uploads everything with at most four PUTs in flight and reports bytes", async () => {
    const presignSizes = stubServer();
    const files = jpegs(10);
    const states: Record<number, string> = {};
    const bytes: Record<number, number> = {};

    await runUploads({
      files,
      credentials: { kind: "owner", galleryId: "gal_1" },
      resumeIds: files.map(() => undefined),
      onItem: (index, patch) => {
        states[index] = patch.state;
      },
      onBytes: (index, sent) => {
        bytes[index] = sent;
      },
      onFatal: () => {
        throw new Error("nothing here is fatal");
      },
    });

    expect(Object.values(states)).toEqual(files.map(() => "done"));
    expect(FakeXHR.peak).toBeLessThanOrEqual(4);
    // Presign never exceeds one batch and covers every file exactly once.
    expect(presignSizes.every((size) => size <= 8)).toBe(true);
    expect(presignSizes.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Object.keys(bytes)).toHaveLength(10);
    vi.unstubAllGlobals();
  });

  it("cancels in-flight and queued files so they can be retried", async () => {
    stubServer();
    let release!: () => void;
    FakeXHR.hold = new Promise((resolve) => {
      release = resolve;
    });
    const files = jpegs(6);
    const results: Record<number, { state: string; error?: string }> = {};
    const controller = new AbortController();

    const run = runUploads({
      files,
      credentials: { kind: "owner", galleryId: "gal_1" },
      resumeIds: files.map(() => undefined),
      signal: controller.signal,
      onItem: (index, patch) => {
        results[index] = patch;
      },
      onFatal: () => undefined,
    });

    await vi.waitFor(() => expect(FakeXHR.open).toBe(4));
    controller.abort();
    release();
    await run;

    const finals = Object.values(results);
    expect(finals).toHaveLength(6);
    expect(finals.every((r) => r.state === "error" && r.error === CANCELLED)).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("runUploads — expiry and late presign", () => {
  const jpeg = (name: string) => new File([new Uint8Array(10)], name, { type: "image/jpeg" });

  it("re-signs an expired URL for the same photo row instead of failing", async () => {
    let photo = 0;
    const resumes: (string | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/uploads/presign")) {
          const files = JSON.parse(String(init?.body)).files as { resumePhotoId?: string }[];
          files.forEach((f) => resumes.push(f.resumePhotoId));
          const uploads = files.map((f) => ({
            photoId: f.resumePhotoId ?? `p${++photo}`,
            objectKey: "k",
            url: "u",
            headers: {},
          }));
          return new Response(JSON.stringify({ uploads }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    FakeXHR.statuses = [403];
    const states: string[] = [];

    await runUploads({
      files: [jpeg("a.jpg")],
      credentials: { kind: "owner", galleryId: "gal_1" },
      resumeIds: [undefined],
      onItem: (_index, patch) => states.push(patch.state),
      onFatal: () => undefined,
    });

    expect(states.at(-1)).toBe("done");
    expect(resumes).toEqual([undefined, "p1"]);
    vi.unstubAllGlobals();
  });

  it("does not report into a run that already ended when cancelled mid-presign", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        await gate;
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Response(JSON.stringify({ uploads: [] }), { status: 200 });
      }),
    );
    const controller = new AbortController();
    let ended = false;
    const lateCalls: string[] = [];

    const run = runUploads({
      files: [jpeg("a.jpg"), jpeg("b.jpg")],
      credentials: { kind: "owner", galleryId: "gal_1" },
      resumeIds: [undefined, undefined],
      signal: controller.signal,
      onItem: (_index, patch) => {
        if (ended) lateCalls.push(patch.state);
      },
      onFatal: () => {
        if (ended) lateCalls.push("fatal");
      },
    });
    controller.abort();
    openGate();
    await run;
    ended = true;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lateCalls).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("runUploads — sizes the server would refuse for the whole batch", () => {
  const jpeg = (name: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type: "image/jpeg" });

  function stubPresign() {
    let photo = 0;
    const signedNames: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/uploads/presign")) {
          const files = JSON.parse(String(init?.body)).files as { fileName: string }[];
          files.forEach((f) => signedNames.push(f.fileName));
          const uploads = files.map(() => ({
            photoId: `p${++photo}`,
            objectKey: "k",
            url: "u",
            headers: {},
          }));
          return new Response(JSON.stringify({ uploads }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    return signedNames;
  }

  it("refuses a guest photo over the ceiling by name and uploads the other three", async () => {
    const signedNames = stubPresign();
    const big = jpeg("BIG.jpg");
    // The real bytes are never read for a refused file; only its size is.
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    const files = [jpeg("a.jpg"), big, jpeg("b.jpg"), jpeg("c.jpg")];
    const results: Record<number, { state: string; error?: string }> = {};
    const skipped: { index: number; code: string; fileName?: string; maxBytes?: number }[] = [];

    await runUploads({
      files,
      credentials: { kind: "guest", shareToken: "tok", anonKey: "anon" },
      resumeIds: files.map(() => undefined),
      onItem: (index, patch) => {
        results[index] = patch;
      },
      onFatal: () => {
        throw new Error("one big photo must not end the run");
      },
      onSkipped: (_first, _count, skips) =>
        skips.forEach(({ index, rejection }) =>
          skipped.push({
            index,
            code: rejection.code,
            fileName: rejection.detail.fileName,
            maxBytes: rejection.detail.maxBytes,
          }),
        ),
    });

    expect(results[0]?.state).toBe("done");
    expect(results[2]?.state).toBe("done");
    expect(results[3]?.state).toBe("done");
    expect(results[1]).toEqual({ state: "error", error: "file_too_large" });
    expect(skipped).toEqual([
      { index: 1, code: "file_too_large", fileName: "BIG.jpg", maxBytes: 25 * 1024 * 1024 },
    ]);
    expect(signedNames).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    vi.unstubAllGlobals();
  });

  it("skips an empty file instead of letting it fail the batch", async () => {
    const signedNames = stubPresign();
    const files = [jpeg("empty.jpg", 0), jpeg("ok.jpg")];
    const skipped: { index: number; reason?: string }[] = [];

    await runUploads({
      files,
      credentials: { kind: "owner", galleryId: "gal_1" },
      resumeIds: files.map(() => undefined),
      onItem: () => undefined,
      onFatal: () => {
        throw new Error("not fatal");
      },
      onSkipped: (_first, _count, skips) =>
        skips.forEach(({ index, rejection }) =>
          skipped.push({ index, reason: rejection.detail.reason }),
        ),
    });

    expect(skipped).toEqual([{ index: 0, reason: "empty" }]);
    expect(signedNames).toEqual(["ok.jpg"]);
    vi.unstubAllGlobals();
  });

  it("reports a failed presign batch per file, never as fatal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
    );
    const results: Record<number, { state: string; error?: string }> = {};
    let fatalCalls = 0;

    await runUploads({
      files: [jpeg("a.jpg"), jpeg("b.jpg")],
      credentials: { kind: "guest", shareToken: "tok", anonKey: null },
      resumeIds: [undefined, undefined],
      onItem: (index, patch) => {
        results[index] = patch;
      },
      onFatal: () => {
        fatalCalls += 1;
      },
    });

    expect(fatalCalls).toBe(0);
    expect(results[0]).toEqual({ state: "error", error: "network" });
    expect(results[1]).toEqual({ state: "error", error: "network" });
    vi.unstubAllGlobals();
  });
});

describe("runUploads — stop and offline", () => {
  const jpegs = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => new File([new Uint8Array(10 + i)], `IMG_${i}.jpg`, { type: "image/jpeg" }),
    );

  function stubServer() {
    let photo = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/uploads/presign")) {
        const files = JSON.parse(String(init?.body)).files as unknown[];
        const uploads = files.map(() => ({
          photoId: `p${++photo}`,
          objectKey: "k",
          url: "u",
          headers: {},
        }));
        return new Response(JSON.stringify({ uploads }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lets files already on the wire finish and cancels the rest on stop", async () => {
    stubServer();
    let release!: () => void;
    FakeXHR.hold = new Promise((resolve) => {
      release = resolve;
    });
    const files = jpegs(6);
    const results: Record<number, { state: string; error?: string }> = {};
    const stop = new AbortController();

    const run = runUploads({
      files,
      credentials: { kind: "guest", shareToken: "tok", anonKey: null },
      resumeIds: files.map(() => undefined),
      stop: stop.signal,
      onItem: (index, patch) => {
        results[index] = patch;
      },
      onFatal: () => undefined,
    });

    await vi.waitFor(() => expect(FakeXHR.open).toBe(4));
    stop.abort();
    release();
    await run;

    const states = Object.values(results);
    expect(states.filter((r) => r.state === "done")).toHaveLength(4);
    expect(states.filter((r) => r.state === "error" && r.error === CANCELLED)).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("waits for the network instead of spending retries while offline", async () => {
    const fetchMock = stubServer();
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const states: string[] = [];

    const run = runUploads({
      files: jpegs(1),
      credentials: { kind: "guest", shareToken: "tok", anonKey: null },
      resumeIds: [undefined],
      onItem: (_index, patch) => states.push(patch.state),
      onFatal: () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing was even signed while the phone had no network.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(states).toEqual([]);

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await run;

    expect(states.at(-1)).toBe("done");
    onLine.mockRestore();
    vi.unstubAllGlobals();
  });
});
