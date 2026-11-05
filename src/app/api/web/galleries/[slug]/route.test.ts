import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ WEB_API_SECRET: "s3cret" as string | undefined }));
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ serverEnv: () => env }));
vi.mock("@/lib/web-gallery", async (original) => ({
  ...(await original<typeof import("@/lib/web-gallery")>()),
  webGalleryBySlug: lookup,
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/r2", () => ({ copyObject: vi.fn() }));
vi.mock("@/lib/zip-build", () => ({ markGalleryPhotosChanged: vi.fn() }));

import { GET } from "./route";

const call = (slug: string, authorization?: string) =>
  GET(
    new Request("https://x/api/web/galleries/" + slug, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ slug }) } as never,
  );

beforeEach(() => {
  env.WEB_API_SECRET = "s3cret";
  lookup.mockReset();
});

describe("GET /api/web/galleries/[slug]", () => {
  it("does not exist without the secret configured", async () => {
    env.WEB_API_SECRET = undefined;
    expect((await call("a", "Bearer s3cret")).status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer before reading anything", async () => {
    expect((await call("a")).status).toBe(401);
    expect((await call("a", "Bearer nope")).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("answers 404 for a slug outside the pattern, without reading anything", async () => {
    expect((await call("../secret", "Bearer s3cret")).status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("answers 404 for what is not a live web gallery, so the website falls back", async () => {
    lookup.mockResolvedValue(null);
    expect((await call("a", "Bearer s3cret")).status).toBe(404);
  });

  it("returns the gallery", async () => {
    lookup.mockResolvedValue({ slug: "a", photos: [] });
    const response = await call("a", "Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "a", photos: [] });
  });
});
