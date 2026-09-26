import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real preparation is covered piece by piece (crc32, exif-gps,
// exif-taken-at, placeholder tests); what matters here is which thread runs it
// and that every failure falls back rather than fails.
const prepareUpload = vi.hoisted(() =>
  vi.fn(async (file: File) => ({
    body: file,
    crc32: "main",
    takenAt: null,
    width: 1,
    height: 1,
    placeholder: null,
  })),
);
vi.mock("@/lib/upload-prepare", () => ({ prepareUpload }));

const file = () => new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });

/** A stand-in Worker whose behaviour each test chooses. */
class FakeWorker {
  static created = 0;
  static mode: "answer" | "error" | "silent" | "fileError" = "answer";
  /** Files handed to the worker and not yet answered. */
  static inFlight = 0;
  static maxInFlight = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.created += 1;
  }
  postMessage({ id }: { id: number; file: File }) {
    FakeWorker.inFlight += 1;
    FakeWorker.maxInFlight = Math.max(FakeWorker.maxInFlight, FakeWorker.inFlight);
    const reply = (data: unknown) =>
      setTimeout(() => {
        FakeWorker.inFlight -= 1;
        this.onmessage?.({ data });
      }, 5);
    if (FakeWorker.mode === "fileError") {
      reply({ id, ok: false, message: "NotReadableError" });
    } else if (FakeWorker.mode === "answer") {
      reply({
        id,
        ok: true,
        result: {
          body: new Blob(),
          crc32: "worker",
          takenAt: null,
          width: 2,
          height: 2,
          placeholder: null,
        },
      });
    } else if (FakeWorker.mode === "error") {
      queueMicrotask(() => this.onerror?.({ message: "boom", preventDefault: () => {} }));
    }
  }
  terminate() {
    this.terminated = true;
  }
}

describe("prepareUploadOffMainThread", () => {
  beforeEach(() => {
    vi.resetModules();
    prepareUpload.mockClear();
    FakeWorker.created = 0;
    FakeWorker.mode = "answer";
    FakeWorker.inFlight = 0;
    FakeWorker.maxInFlight = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prepares in the worker, and creates it only once", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    expect((await prepareUploadOffMainThread(file())).crc32).toBe("worker");
    expect((await prepareUploadOffMainThread(file())).crc32).toBe("worker");
    expect(FakeWorker.created).toBe(1);
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("hands the worker one file at a time, even when three are asked for at once", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    const results = await Promise.all([file(), file(), file()].map(prepareUploadOffMainThread));
    expect(results.map((r) => r.crc32)).toEqual(["worker", "worker", "worker"]);
    expect(FakeWorker.maxInFlight).toBe(1);
  });

  it("passes a file's own failure on, without re-reading it on the main thread", async () => {
    FakeWorker.mode = "fileError";
    vi.stubGlobal("Worker", FakeWorker);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    await expect(prepareUploadOffMainThread(file())).rejects.toThrow("NotReadableError");
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("runs on the main thread where no worker can be created", async () => {
    vi.stubGlobal("Worker", undefined);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    expect((await prepareUploadOffMainThread(file())).crc32).toBe("main");
  });

  it("falls back when the worker fails, and stops using it", async () => {
    FakeWorker.mode = "error";
    vi.stubGlobal("Worker", FakeWorker);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    expect((await prepareUploadOffMainThread(file())).crc32).toBe("main");
    FakeWorker.mode = "answer";
    expect((await prepareUploadOffMainThread(file())).crc32).toBe("main");
    expect(FakeWorker.created).toBe(1);
  });

  it("falls back when the worker goes quiet", async () => {
    vi.useFakeTimers();
    FakeWorker.mode = "silent";
    vi.stubGlobal("Worker", FakeWorker);
    const { prepareUploadOffMainThread } = await import("./upload-prepare-client");
    const result = prepareUploadOffMainThread(file());
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await result).crc32).toBe("main");
  });
});
