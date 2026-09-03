import { describe, expect, it } from "vitest";
import { buildScopeId } from "./zip-build-scope";

const SECRET = "a-build-signing-secret-that-is-long-enough";

describe("buildScopeId", () => {
  it("is deterministic, so the app and the Worker land on the same key", async () => {
    const a = await buildScopeId("cmtj3j1pt000004jjworke62r", SECRET);
    const b = await buildScopeId("cmtj3j1pt000004jjworke62r", SECRET);
    expect(a).toBe(b);
  });

  it("does not contain the gallery id it was derived from", async () => {
    // The whole point: `_zip-builds/{galleryId}.json` was publicly fetchable
    // from the CDN, and the object behind it lists every photo's key. A viewer
    // holding a gallery id — which the gallery page gives out — could read it
    // during any rebuild, long after their share link expired.
    const galleryId = "cmtj3j1pt000004jjworke62r";
    const scope = await buildScopeId(galleryId, SECRET);
    expect(scope).not.toContain(galleryId);
    expect(scope).toMatch(/^[0-9a-f]{32}$/);
  });

  it("cannot be computed without the secret", async () => {
    const withSecret = await buildScopeId("g1", SECRET);
    const withOther = await buildScopeId("g1", "a-different-secret-of-similar-size");
    expect(withOther).not.toBe(withSecret);
  });

  it("separates galleries", async () => {
    const a = await buildScopeId("g1", SECRET);
    const b = await buildScopeId("g2", SECRET);
    expect(a).not.toBe(b);
  });

  it("produces a key with no path separators, so prefix scoping holds", async () => {
    // `sweepBuilds` tells a tracking manifest from a part marker by looking for
    // a "/" in the remainder of the key — a scope containing one would make
    // every part marker look like a build to finalize.
    const scope = await buildScopeId("g1", SECRET);
    expect(scope).not.toContain("/");
    expect(scope).not.toContain(".");
  });
});
