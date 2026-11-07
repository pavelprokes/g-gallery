import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
const places = vi.hoisted(() => ({
  assignWebPlaceFor: vi.fn(),
  createWebPlaceGalleryFor: vi.fn(),
  createPortfolioGalleryFor: vi.fn(),
}));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-guard", () => ({ requireAdmin }));
vi.mock("@/lib/web-places", () => places);
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/r2", () => ({ copyObject: vi.fn() }));
vi.mock("@/lib/zip-build", () => ({ markGalleryPhotosChanged: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import {
  addSuggestionToPortfolio,
  assignWebPlace,
  clearWebPlace,
  createWebPlaceGallery,
} from "./web-place-actions";

const ID = "cmuo9cuzl000004l9xri9fuyu";
const form = (galleryId: string) => {
  const data = new FormData();
  data.set("galleryId", galleryId);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ user: { id: "owner" } });
});

describe("web place actions", () => {
  it("need a session, because a Server Action is a public endpoint", async () => {
    requireAdmin.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(assignWebPlace("misto-homepage", form(ID))).rejects.toThrow("UNAUTHORIZED");
    await expect(clearWebPlace("misto-homepage")).rejects.toThrow("UNAUTHORIZED");
    await expect(createWebPlaceGallery("misto-homepage", "Homepage")).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(places.assignWebPlaceFor).not.toHaveBeenCalled();
  });

  it("act for the signed-in owner", async () => {
    await assignWebPlace("misto-homepage", form(ID));
    expect(places.assignWebPlaceFor).toHaveBeenCalledWith("owner", "misto-homepage", ID);
    await clearWebPlace("misto-cenik");
    expect(places.assignWebPlaceFor).toHaveBeenLastCalledWith("owner", "misto-cenik", null);
  });

  it("cannot be used to take a couple's address", async () => {
    await expect(assignWebPlace("eliska-a-martin-2026", form(ID))).rejects.toThrow("INVALID_INPUT");
    await expect(clearWebPlace("eliska-a-martin-2026")).rejects.toThrow("INVALID_INPUT");
    await expect(createWebPlaceGallery("eliska-a-martin-2026", "x")).rejects.toThrow(
      "INVALID_INPUT",
    );
    expect(places.assignWebPlaceFor).not.toHaveBeenCalled();
  });

  it("needs a gallery in the form", async () => {
    await expect(assignWebPlace("misto-homepage", form(""))).rejects.toThrow("INVALID_INPUT");
  });

  it("goes straight to a new gallery to fill it", async () => {
    places.createWebPlaceGalleryFor.mockResolvedValue("g1");
    await createWebPlaceGallery("misto-homepage", "Homepage");
    expect(places.createWebPlaceGalleryFor).toHaveBeenCalledWith(
      "owner",
      "misto-homepage",
      "Homepage",
    );
    expect(redirect).toHaveBeenCalledWith("/admin/g/g1");
  });
});

describe("addSuggestionToPortfolio", () => {
  const suggestion = (webSlug: string, photos = [ID]) => {
    const data = new FormData();
    data.set("webSlug", webSlug);
    for (const photo of photos) data.append("photo", photo);
    return data;
  };
  // As in Next: a redirect ends the action.
  beforeEach(() => {
    redirect.mockImplementation((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    });
  });

  it("needs a session", async () => {
    requireAdmin.mockRejectedValue(new Error("UNAUTHORIZED"));
    await expect(addSuggestionToPortfolio(ID, suggestion("anna-a-petr"))).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(places.createPortfolioGalleryFor).not.toHaveBeenCalled();
  });

  it("makes the draft for the owner and goes to it", async () => {
    places.createPortfolioGalleryFor.mockResolvedValue({ id: "new", copied: 1, failed: 0 });
    await expect(addSuggestionToPortfolio(ID, suggestion("anna-a-petr"))).rejects.toThrow(
      "REDIRECT /admin/g/new",
    );
    expect(places.createPortfolioGalleryFor).toHaveBeenCalledWith("owner", ID, "anna-a-petr", [ID]);
  });

  it.each([
    ["a place's key", "misto-homepage", [ID]],
    ["a malformed address", "Anna a Petr", [ID]],
    ["no photo", "anna-a-petr", []],
  ])("refuses %s", async (_what, slug, photos) => {
    await expect(addSuggestionToPortfolio(ID, suggestion(slug, photos))).rejects.toThrow(
      "REDIRECT /admin/web?chyba=vstup&doporuceni=0",
    );
    expect(places.createPortfolioGalleryFor).not.toHaveBeenCalled();
  });

  it.each([
    ["none copied", { id: "new", copied: 0, failed: 2 }, "kopie"],
    ["some copied", { id: "new", copied: 1, failed: 1 }, "cast"],
  ])("says so when %s", async (_what, made, problem) => {
    places.createPortfolioGalleryFor.mockResolvedValue(made);
    await expect(addSuggestionToPortfolio(ID, suggestion("anna-a-petr"))).rejects.toThrow(
      `REDIRECT /admin/web?chyba=${problem}&doporuceni=0`,
    );
  });

  it("says so when the address is taken", async () => {
    places.createPortfolioGalleryFor.mockRejectedValue(
      Object.assign(new Error(), { code: "P2002" }),
    );
    const form = suggestion("anna-a-petr");
    form.set("from", "3");
    await expect(addSuggestionToPortfolio(ID, form)).rejects.toThrow(
      "REDIRECT /admin/web?chyba=adresa&doporuceni=3",
    );
  });
});
