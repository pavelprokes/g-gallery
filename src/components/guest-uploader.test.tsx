import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadRunOptions } from "@/lib/upload-run";

const queue = vi.hoisted(() => ({
  listQueuedUploads: vi.fn(),
  enqueueUploads: vi.fn(),
  dequeueUpload: vi.fn(async (id: string) => {
    void id;
  }),
  clearQueuedUploads: vi.fn(async () => undefined),
}));
vi.mock("@/lib/upload-queue", () => queue);

const runUploads = vi.hoisted(() => vi.fn<(options: UploadRunOptions) => Promise<void>>());
vi.mock("@/lib/upload-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload-run")>()),
  runUploads,
  fetchPendingUploads: vi.fn(async () => []),
}));

vi.mock("@/lib/wake-lock", () => ({ holdScreenAwake: async () => null }));
vi.mock("@/lib/viewer-id", () => ({
  clearViewerName: vi.fn(),
  getOptOutServerSnapshot: () => false,
  getOptOutSnapshot: () => false,
  getViewerId: () => "anon",
  getViewerName: () => "Petra",
  getViewerNameServerSnapshot: () => null,
  hasAnsweredUploadName: () => true,
  markUploadNameAnswered: vi.fn(),
  setViewerName: vi.fn(),
  subscribeOptOut: () => () => undefined,
  subscribeViewerName: () => () => undefined,
}));
// Echoing the key keeps these tests about behaviour rather than copy.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "cs",
}));

import {
  byteProgress,
  formatMegabytes,
  GuestUploader,
  isRetryable,
  skippedQueueIds,
} from "@/components/guest-uploader";
import { CANCELLED, UploadRejection } from "@/lib/upload-run";

const jpeg = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg" });

const entries = ["a.jpg", "b.jpg", "c.jpg"].map((name, i) => ({
  id: `id${i}`,
  token: "tok",
  file: jpeg(name),
  addedAt: i,
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderUploader() {
  return render(<GuestUploader token="tok" onUploaded={vi.fn()} onRenamed={vi.fn()} />);
}

describe("GuestUploader — resume, skip and retry", () => {
  it("dequeues only the skipped file, and offers the failed one again", async () => {
    queue.listQueuedUploads.mockResolvedValue(entries);
    // a.jpg lands, b.jpg is refused up front, c.jpg fails on the network.
    runUploads.mockImplementationOnce(async ({ onItem, onSkipped }) => {
      const rejection = new UploadRejection("file_too_large", {
        fileName: "b.jpg",
        maxBytes: 25 * 1024 * 1024,
      });
      onItem(1, { state: "error", error: "file_too_large" });
      onSkipped?.(rejection, 1, [{ index: 1, rejection }]);
      onItem(0, { state: "done" });
      onItem(2, { state: "error", error: "R2 PUT failed (network)" });
    });
    runUploads.mockImplementationOnce(async ({ onItem }) => onItem(0, { state: "done" }));

    renderUploader();

    const retry = await screen.findByRole("button", { name: "retryFailed" });
    const dequeued = queue.dequeueUpload.mock.calls.map(([id]) => id).sort();
    expect(dequeued).toEqual(["id0", "id1"]);
    // The refusal names the file; the partial summary replaces "uploaded".
    expect(screen.getByRole("alert")).toHaveTextContent("b.jpg");
    expect(screen.getByRole("status")).toHaveTextContent("donePartial");

    fireEvent.click(retry);
    await waitFor(() => expect(runUploads).toHaveBeenCalledTimes(2));
    expect(runUploads.mock.calls[1]![0].files.map((file) => file.name)).toEqual(["c.jpg"]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("doneSome"));
  });

  it("keeps the uploaded count next to a refusal that ended the run", async () => {
    queue.listQueuedUploads.mockResolvedValue(entries);
    runUploads.mockImplementationOnce(async ({ onItem, onFatal }) => {
      onItem(0, { state: "done" });
      onItem(1, { state: "done" });
      onItem(2, { state: "error" });
      onFatal(new UploadRejection("quota_exceeded", { reason: "VIEWER_FULL" }));
    });

    renderUploader();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("landedCount"));
    expect(screen.getByRole("alert")).toHaveTextContent("quotaViewerFull");
    // Nothing a retry could fix: the quota will refuse it again.
    expect(screen.queryByRole("button", { name: "retryFailed" })).toBeNull();
  });

  it("never starts a second run when the guest comes back mid-upload", async () => {
    queue.listQueuedUploads.mockResolvedValue(entries);
    let finish!: () => void;
    runUploads.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    renderUploader();
    await waitFor(() => expect(runUploads).toHaveBeenCalledTimes(1));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    // The picker is disabled while a run is going.
    expect(screen.getByLabelText("addPhotos")).toBeDisabled();

    await act(async () => finish());
    expect(queue.listQueuedUploads).toHaveBeenCalledTimes(1);
    expect(runUploads).toHaveBeenCalledTimes(1);
  });

  it("resumes what is still queued when the tab becomes visible again", async () => {
    queue.listQueuedUploads.mockResolvedValueOnce([]);
    renderUploader();
    await waitFor(() => expect(queue.listQueuedUploads).toHaveBeenCalledTimes(1));

    queue.listQueuedUploads.mockResolvedValueOnce(entries.slice(2));
    runUploads.mockImplementationOnce(async ({ onItem }) => onItem(0, { state: "done" }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(runUploads).toHaveBeenCalledTimes(1));
    expect(runUploads.mock.calls[0]![0].files.map((file) => file.name)).toEqual(["c.jpg"]);
  });

  it("stops starting new files when the rest is discarded", async () => {
    queue.listQueuedUploads.mockResolvedValue(entries);
    let stop: AbortSignal | undefined;
    let finish!: () => void;
    runUploads.mockImplementationOnce(({ stop: signal }) => {
      stop = signal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });

    renderUploader();
    fireEvent.click(await screen.findByRole("button", { name: "discardRest" }));

    expect(stop?.aborted).toBe(true);
    expect(queue.clearQueuedUploads).toHaveBeenCalledWith("tok");
    await act(async () => finish());
  });
});

describe("guest uploader helpers", () => {
  it("picks the queue ids of the skipped indices only", () => {
    expect(skippedQueueIds(entries, [{ index: 1 }, { index: 7 }])).toEqual(["id1"]);
  });

  it("offers again only what failed on the way, not what was refused or discarded", () => {
    expect(isRetryable({ state: "error", error: "network" })).toBe(true);
    expect(isRetryable({ state: "error", error: "file_too_large", skipped: true })).toBe(false);
    expect(isRetryable({ state: "error", error: CANCELLED })).toBe(false);
    expect(isRetryable({ state: "done" })).toBe(false);
  });

  it("measures progress in bytes and ignores files that failed", () => {
    const items = [
      { file: jpeg("a", 100), state: "done" as const },
      { file: jpeg("b", 300), state: "uploading" as const },
      { file: jpeg("c", 1000), state: "error" as const },
    ];
    expect(byteProgress(items, [0, 100, 0])).toBeCloseTo(0.5);
    // A progress event can overshoot the stored size (GPS stripped); clamp it.
    expect(byteProgress(items, [0, 900, 0])).toBe(1);
  });

  it("formats the size ceiling with a non-breaking space", () => {
    expect(formatMegabytes(25 * 1024 * 1024, "cs")).toBe("25 MB");
    // French ICU data already uses the narrow no-break space; it stays.
    expect(formatMegabytes(25 * 1024 * 1024, "fr")).toMatch(/^25[  ]Mo$/);
  });
});
