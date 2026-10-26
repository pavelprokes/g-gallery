import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveShareLink = vi.hoisted(() => vi.fn());
const trackServerEvent = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  gallery: { findUnique: vi.fn() },
  activityEvent: { create: vi.fn() },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Outside a request there is no `after()` scope; run the work inline.
  after: (work: () => unknown) => void work(),
}));
vi.mock("@/lib/share-access", () => ({ resolveShareLink }));
vi.mock("@/lib/umami", () => ({ trackServerEvent }));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/shared-gallery", () => ({
  archiveUrlOf: (key: string | null, builtAt: Date | null) =>
    key && builtAt ? `https://cdn.test/${key}` : null,
}));

import { GET } from "./route";

/** `RouteContext` is a Next-generated type; the handler only awaits `params`. */
const ctx = { params: Promise.resolve({ token: "tok" }) } as Parameters<typeof GET>[1];

function get(init?: RequestInit): Request {
  return new Request("https://example.test/api/g/tok/archive", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveShareLink.mockResolvedValue({
    ok: true,
    shareLink: { id: "share_1", galleryId: "gal_1", allowDownload: true },
  });
  prisma.gallery.findUnique.mockResolvedValue({
    zipObjectKey: "galleries/g/_archive-1.zip",
    zipBuiltAt: new Date(),
  });
  prisma.activityEvent.create.mockResolvedValue({});
});

const GALLERY_PAGE = "https://example.test/g/tok/svatba";

describe("GET /api/g/[token]/archive", () => {
  it("counts the download, then redirects to the built archive", async () => {
    const response = await GET(get(), ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://cdn.test/galleries/g/_archive-1.zip");
    expect(prisma.activityEvent.create).toHaveBeenCalledWith({
      data: { galleryId: "gal_1", type: "DOWNLOAD" },
    });
    expect(trackServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "gallery-download",
        data: { partial: false, prebuilt: true },
      }),
    );
  });

  it("still redirects when the download cannot be recorded", async () => {
    prisma.activityEvent.create.mockRejectedValue(new Error("pooler down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(get(), ctx);

    expect(response.status).toBe(302);
  });

  it("counts a first request that asks for the range from byte 0", async () => {
    await GET(get({ headers: { range: "bytes=0-" } }), ctx);

    expect(prisma.activityEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not count a resumed download or a HEAD probe again", async () => {
    const resumed = await GET(get({ headers: { range: "bytes=1000-" } }), ctx);
    const probe = await GET(get({ method: "HEAD" }), ctx);

    expect([resumed.status, probe.status]).toEqual([302, 302]);
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
    expect(trackServerEvent).not.toHaveBeenCalled();
  });

  it("sends a dead link or one with downloads off back to the gallery page", async () => {
    // Opened by navigation: the gallery page explains an expired link or asks
    // for the password, where a JSON error would strand the guest.
    resolveShareLink.mockResolvedValueOnce({ ok: false, reason: "EXPIRED" });
    const expired = await GET(get({ headers: { referer: GALLERY_PAGE } }), ctx);

    resolveShareLink.mockResolvedValueOnce({
      ok: true,
      shareLink: { id: "share_1", galleryId: "gal_1", allowDownload: false },
    });
    const disabled = await GET(get({ headers: { referer: GALLERY_PAGE } }), ctx);

    for (const response of [expired, disabled]) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(GALLERY_PAGE);
    }
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
  });

  it("never sends the guest back to another site", async () => {
    resolveShareLink.mockResolvedValueOnce({ ok: false, reason: "EXPIRED" });

    const response = await GET(get({ headers: { referer: "https://evil.test/x" } }), ctx);

    expect(response.headers.get("location")).toBe("https://example.test/");
  });

  it("goes back, uncounted, while no archive has been built", async () => {
    prisma.gallery.findUnique.mockResolvedValue({ zipObjectKey: null, zipBuiltAt: null });

    const response = await GET(get({ headers: { referer: GALLERY_PAGE } }), ctx);

    expect(response.status).toBe(303);
    expect(prisma.activityEvent.create).not.toHaveBeenCalled();
  });
});
