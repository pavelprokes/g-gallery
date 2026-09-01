import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveShareLink = vi.hoisted(() => vi.fn());
const recordActivity = vi.hoisted(() => vi.fn());
const pushNewViewer = vi.hoisted(() => vi.fn());

vi.mock("@/lib/share-access", () => ({ resolveShareLink }));
vi.mock("@/lib/activity", () => ({ recordActivity }));
vi.mock("@/lib/push", () => ({ pushNewViewer }));

import { POST } from "./route";

const ANON_KEY = "2b6f0cc9-04d6-4b8f-9a0f-3f9b6b2f2f11";

/** `RouteContext` is a Next-generated type; the handler only awaits `params`. */
const ctx = { params: Promise.resolve({ token: "tok" }) } as Parameters<typeof POST>[1];

function post(body: unknown): Request {
  return new Request("https://example.test/api/g/tok/activity", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveShareLink.mockResolvedValue({
    ok: true,
    shareLink: { id: "share_1", galleryId: "gal_1" },
  });
  recordActivity.mockResolvedValue({ newSession: false, viewerName: null });
});

describe("POST /api/g/[token]/activity", () => {
  it("records a promo click against the gallery, with no photo", async () => {
    const response = await POST(post({ anonKey: ANON_KEY, type: "PROMO_CLICK" }), ctx);

    expect(response.status).toBe(204);
    expect(recordActivity).toHaveBeenCalledWith({
      galleryId: "gal_1",
      shareLinkId: "share_1",
      anonKey: ANON_KEY,
      photoId: undefined,
      type: "PROMO_CLICK",
    });
  });

  it("rejects a promo click carrying a photo id", async () => {
    // A promo is never a photo (docs/PROMO-CARDS.md); accepting one here would
    // land a PROMO_CLICK in the per-photo counts.
    const response = await POST(
      post({ anonKey: ANON_KEY, type: "PROMO_CLICK", photoId: "photo_1" }),
      ctx,
    );

    expect(response.status).toBe(400);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("still accepts the view types the gallery already beacons", async () => {
    const view = await POST(post({ anonKey: ANON_KEY, type: "GALLERY_VIEW" }), ctx);
    const photo = await POST(
      post({ anonKey: ANON_KEY, type: "PHOTO_VIEW", photoId: "photo_1" }),
      ctx,
    );

    expect([view.status, photo.status]).toEqual([204, 204]);
    expect(recordActivity).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown activity type", async () => {
    const response = await POST(post({ anonKey: ANON_KEY, type: "PROMO_IMPRESSION" }), ctx);

    expect(response.status).toBe(400);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("resolves the share link before recording anything", async () => {
    // Expiry and revocation are enforced on every surface, the beacon included
    // (CLAUDE.md invariant #5) — a dead link must not be able to write.
    resolveShareLink.mockResolvedValue({ ok: false, reason: "EXPIRED" });

    const response = await POST(post({ anonKey: ANON_KEY, type: "PROMO_CLICK" }), ctx);

    expect(response.status).toBe(404);
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("never notifies the owner about a promo click", async () => {
    // The push is for a new viewer session; a click inside one is not news.
    recordActivity.mockResolvedValue({ newSession: false, viewerName: "Anna" });

    await POST(post({ anonKey: ANON_KEY, type: "PROMO_CLICK" }), ctx);

    expect(pushNewViewer).not.toHaveBeenCalled();
  });
});
