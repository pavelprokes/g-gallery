import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  gallery: { updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  photo: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const env = vi.hoisted(() => ({ WEBSITE_URL: undefined as string | undefined }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/env", () => ({ serverEnv: () => env }));
vi.mock("@/lib/r2", () => ({ copyObject: vi.fn() }));
vi.mock("@/lib/zip-build", () => ({ markGalleryPhotosChanged: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignWebPlaceFor, fetchWebPlaces } from "./web-places";

const place = {
  key: "misto-homepage",
  label: "Homepage",
  where: "/",
  positions: ["Hero"],
  landscape: true,
  coverFirst: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  env.WEBSITE_URL = undefined;
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<void>) => run(db));
  db.gallery.updateMany.mockResolvedValue({ count: 1 });
});

describe("fetchWebPlaces", () => {
  const answer = (body: unknown, ok = true) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, json: async () => body } as Response);

  it("reads the list from the production website unless told otherwise", async () => {
    const fetchMock = answer({ places: [place] });
    await expect(fetchWebPlaces()).resolves.toEqual([place]);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://svatebni-fotograf-cechy.cz/api/photo-places");

    env.WEBSITE_URL = "http://localhost:3203/";
    await fetchWebPlaces();
    expect(fetchMock.mock.calls[1]![0]).toBe("http://localhost:3203/api/photo-places");
  });

  it("refuses a key that could be a couple's page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    answer({ places: [{ ...place, key: "eliska-a-martin-2026" }] });
    await expect(fetchWebPlaces()).resolves.toBeNull();
  });

  it("is null when the website does not answer", async () => {
    answer({}, false);
    await expect(fetchWebPlaces()).resolves.toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(fetchWebPlaces()).resolves.toBeNull();
  });
});

describe("assignWebPlaceFor", () => {
  it("empties the place first, then fills it, in one transaction", async () => {
    await assignWebPlaceFor("owner", "misto-homepage", "g1");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.gallery.updateMany.mock.calls.map(([call]) => call)).toEqual([
      { where: { ownerId: "owner", webSlug: "misto-homepage" }, data: { webSlug: null } },
      {
        where: { id: "g1", ownerId: "owner", trashedAt: null, webSlug: null },
        data: { webSlug: "misto-homepage" },
      },
    ]);
  });

  it("only empties when no gallery is given", async () => {
    await assignWebPlaceFor("owner", "misto-homepage", null);
    expect(db.gallery.updateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses a gallery that is someone else's, trashed, or already on the website", async () => {
    db.gallery.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(assignWebPlaceFor("owner", "misto-homepage", "g1")).rejects.toThrow("NOT_FOUND");
  });
});
