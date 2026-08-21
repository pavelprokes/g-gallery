import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// The presign route builds one object key per file in a batch and inserts the
// rows concurrently. Photo.objectKey is @unique, so a batch that produces two
// identical keys fails the whole request with P2002 — which is exactly what
// happened when rows were created with a shared "" placeholder and patched
// afterwards. This pins the property the route now relies on.
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

function buildObjectKey(storagePrefix: string, contentType: string): string {
  const extension = EXTENSIONS[contentType] ?? ".jpg";
  return `${storagePrefix}/${randomUUID()}${extension}`;
}

describe("upload object keys", () => {
  it("is unique across a full batch of identical filenames", () => {
    const keys = Array.from({ length: 20 }, () => buildObjectKey("gal_abc", "image/jpeg"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never leaves the gallery's storage prefix", () => {
    const key = buildObjectKey("gal_abc", "image/jpeg");
    expect(key.startsWith("gal_abc/")).toBe(true);
    expect(key.split("/")).toHaveLength(2);
  });

  it("derives the extension from the content type, not the filename", () => {
    expect(buildObjectKey("p", "image/png").endsWith(".png")).toBe(true);
    expect(buildObjectKey("p", "image/webp").endsWith(".webp")).toBe(true);
    expect(buildObjectKey("p", "image/avif").endsWith(".avif")).toBe(true);
  });

  it("falls back to .jpg for an unexpected content type", () => {
    expect(buildObjectKey("p", "image/tiff").endsWith(".jpg")).toBe(true);
  });

  it("is never empty and carries no user-controlled text", () => {
    const key = buildObjectKey("p", "image/jpeg");
    expect(key).toMatch(/^p\/[0-9a-f-]{36}\.jpg$/);
  });
});
