import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gallery: { findFirst: vi.fn(), updateMany: vi.fn() },
  shareLink: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
const admin = vi.hoisted(() => ({ updateGalleryFor: vi.fn() }));
const web = vi.hoisted(() => ({ copyPhotosToWebGalleryFor: vi.fn() }));
const requireAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/r2", () => ({ deleteObject: vi.fn(), copyObject: vi.fn() }));
vi.mock("@/lib/zip-build", () => ({ markGalleryPhotosChanged: vi.fn() }));
vi.mock("@/lib/gallery-admin", async (original) => ({
  ...(await original<typeof import("@/lib/gallery-admin")>()),
  ...admin,
}));
vi.mock("@/lib/web-gallery", async (original) => ({
  ...(await original<typeof import("@/lib/web-gallery")>()),
  ...web,
}));

import { copyPhotosToWebGallery, trashGallery, updateGallery } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const ID = "cmuo9cuzl000004l9xri9fuyu";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user: { id: "owner" } });
});

describe("trashGallery", () => {
  it("refuses a web gallery and changes nothing", async () => {
    db.gallery.findFirst.mockResolvedValue({ id: ID });
    await expect(trashGallery(ID)).rejects.toThrow("WEB_GALLERY_IN_USE");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.shareLink.updateMany).not.toHaveBeenCalled();
  });

  it("still trashes an ordinary gallery", async () => {
    db.gallery.findFirst.mockResolvedValue(null);
    await trashGallery(ID);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("updateGallery and the web slug", () => {
  it("leaves the slug alone when the form does not carry it", async () => {
    await updateGallery(ID, form({ title: "Svatba" }));
    expect(admin.updateGalleryFor.mock.calls[0]![2].webSlug).toBeUndefined();
  });

  it("removes the slug when it is emptied", async () => {
    await updateGallery(ID, form({ title: "Svatba", webSlug: "" }));
    expect(admin.updateGalleryFor.mock.calls[0]![2].webSlug).toBeNull();
  });

  it("sets a valid slug and refuses one outside the pattern", async () => {
    await updateGallery(ID, form({ title: "Svatba", webSlug: "eliska-a-martin-2026" }));
    expect(admin.updateGalleryFor.mock.calls[0]![2].webSlug).toBe("eliska-a-martin-2026");
    await expect(updateGallery(ID, form({ title: "Svatba", webSlug: "Eliška/x" }))).rejects.toThrow(
      "INVALID_INPUT",
    );
  });

  it("says so when another gallery already has the slug", async () => {
    admin.updateGalleryFor.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "P2002" }));
    await expect(updateGallery(ID, form({ title: "Svatba", webSlug: "a" }))).resolves.toEqual({
      error: "WEB_SLUG_TAKEN",
    });
  });
});

describe("copyPhotosToWebGallery", () => {
  it("needs a session, because a Server Action is a public endpoint", async () => {
    requireAdmin.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(copyPhotosToWebGallery(ID, [ID])).rejects.toThrow("UNAUTHORIZED");
    expect(web.copyPhotosToWebGalleryFor).not.toHaveBeenCalled();
  });

  it("copies for the signed-in owner only", async () => {
    web.copyPhotosToWebGalleryFor.mockResolvedValue({ copied: 1, skipped: 0, failed: 0 });
    await expect(copyPhotosToWebGallery(ID, [ID])).resolves.toEqual({
      copied: 1,
      skipped: 0,
      failed: 0,
    });
    expect(web.copyPhotosToWebGalleryFor).toHaveBeenCalledWith("owner", ID, [ID]);
  });

  it("refuses more than one copy may take", async () => {
    await expect(copyPhotosToWebGallery(ID, Array(61).fill(ID))).rejects.toThrow("INVALID_INPUT");
    await expect(copyPhotosToWebGallery(ID, [])).rejects.toThrow("INVALID_INPUT");
  });
});
