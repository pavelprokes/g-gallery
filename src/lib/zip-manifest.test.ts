import { describe, expect, it } from "vitest";
import {
  sanitizeEntryName,
  signManifest,
  uniqueNames,
  verifyManifest,
  type Manifest,
} from "./zip-manifest";

const SECRET = "zip-signing-secret-at-least-32-chars!!";

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    galleryId: "g1",
    archiveName: "svatba.zip",
    entries: [{ key: "galleries/a/1.jpg", name: "1.jpg", size: 100, crc32: "deadbeef" }],
    exp: Math.floor(Date.now() / 1000) + 300,
    ...over,
  };
}

describe("manifest signing", () => {
  it("round-trips a valid manifest", async () => {
    const token = await signManifest(manifest(), SECRET);
    const result = await verifyManifest(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entries[0]!.key).toBe("galleries/a/1.jpg");
  });

  it("rejects a manifest signed with a different secret", async () => {
    const token = await signManifest(manifest(), SECRET);
    expect(await verifyManifest(token, "some-other-secret-value-here!!!!")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered key list", async () => {
    // The whole point: a viewer must not be able to add someone else's gallery.
    const token = await signManifest(manifest(), SECRET);
    const [payload, signature] = token.split(".");
    const evil = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Manifest;
    evil.entries.push({ key: "galleries/victim/1.jpg", name: "x.jpg", size: 1, crc32: null });
    const forged = `${Buffer.from(JSON.stringify(evil)).toString("base64url")}.${signature}`;

    expect(await verifyManifest(forged, SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired manifest", async () => {
    const token = await signManifest(manifest({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
    expect(await verifyManifest(token, SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const bad of ["", ".", "abc", "abc.", ".abc", "not-base64!.also-not"]) {
      const result = await verifyManifest(bad, SECRET);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a manifest with no entries", async () => {
    const token = await signManifest(manifest({ entries: [] }), SECRET);
    expect(await verifyManifest(token, SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("survives a 500-photo manifest", async () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      key: `galleries/abc/${i}.jpg`,
      name: `svatba_${i}.jpg`,
      size: 16_000_000,
      crc32: "aabbccdd",
    }));
    const token = await signManifest(manifest({ entries }), SECRET);
    const result = await verifyManifest(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entries).toHaveLength(500);
  });
});

describe("uniqueNames", () => {
  it("leaves distinct names alone", () => {
    expect(uniqueNames(["a.jpg", "b.jpg"])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("disambiguates duplicates before the extension", () => {
    // Two cameras with the same counter is normal at a wedding, and a ZIP with
    // duplicate names extracts unpredictably.
    expect(uniqueNames(["IMG_001.jpg", "IMG_001.jpg", "IMG_001.jpg"])).toEqual([
      "IMG_001.jpg",
      "IMG_001 (1).jpg",
      "IMG_001 (2).jpg",
    ]);
  });

  it("treats names differing only in case as duplicates", () => {
    // Windows and macOS filesystems are case-insensitive by default.
    expect(uniqueNames(["A.jpg", "a.jpg"])).toEqual(["A.jpg", "a (1).jpg"]);
  });

  it("handles a name with no extension", () => {
    expect(uniqueNames(["photo", "photo"])).toEqual(["photo", "photo (1)"]);
  });
});

describe("sanitizeEntryName", () => {
  it("strips directory components", () => {
    expect(sanitizeEntryName("a/b/c.jpg")).toBe("c.jpg");
    expect(sanitizeEntryName("C:\\Users\\x\\c.jpg")).toBe("c.jpg");
  });

  it("refuses traversal names", () => {
    // "../../etc/passwd" must never survive into an archive entry.
    expect(sanitizeEntryName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeEntryName("..")).toBe("photo.jpg");
    expect(sanitizeEntryName("/")).toBe("photo.jpg");
  });

  it("removes control characters", () => {
    expect(sanitizeEntryName("a\u0000b\u001f.jpg")).toBe("ab.jpg");
  });

  it("keeps diacritics — ZIP entry names are UTF-8", () => {
    expect(sanitizeEntryName("svatba_příprava.jpg")).toBe("svatba_příprava.jpg");
  });

  it("caps absurd lengths", () => {
    expect(sanitizeEntryName("x".repeat(500)).length).toBe(200);
  });
});
