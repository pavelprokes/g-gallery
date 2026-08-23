import { describe, expect, it } from "vitest";
import { signBuildManifest, verifyBuildManifest, type BuildManifest } from "./zip-build-manifest";

const SECRET = "zip-build-signing-secret-at-least-32-chars!!";

function manifest(over: Partial<BuildManifest> = {}): BuildManifest {
  return {
    galleryId: "g1",
    objectKey: "galleries/a/_archive.zip",
    archiveName: "svatba.zip",
    entries: [{ key: "galleries/a/1.jpg", name: "1.jpg", size: 100, crc32: "deadbeef" }],
    exp: Math.floor(Date.now() / 1000) + 300,
    ...over,
  };
}

describe("build manifest signing", () => {
  it("round-trips a valid manifest", async () => {
    const token = await signBuildManifest(manifest(), SECRET);
    const result = await verifyBuildManifest(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.objectKey).toBe("galleries/a/_archive.zip");
  });

  it("rejects a manifest signed with a different secret", async () => {
    const token = await signBuildManifest(manifest(), SECRET);
    expect(await verifyBuildManifest(token, "some-other-secret-value-here!!!!")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered object key — the whole point is the builder trusts this to say where to write", async () => {
    const token = await signBuildManifest(manifest(), SECRET);
    const [payload, signature] = token.split(".");
    const evil = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as BuildManifest;
    evil.objectKey = "galleries/victim/_archive.zip";
    const forged = `${Buffer.from(JSON.stringify(evil)).toString("base64url")}.${signature}`;

    expect(await verifyBuildManifest(forged, SECRET)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an expired manifest", async () => {
    const token = await signBuildManifest(
      manifest({ exp: Math.floor(Date.now() / 1000) - 1 }),
      SECRET,
    );
    expect(await verifyBuildManifest(token, SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const bad of ["", ".", "abc", "abc.", ".abc", "not-base64!.also-not"]) {
      const result = await verifyBuildManifest(bad, SECRET);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a manifest with no entries", async () => {
    const token = await signBuildManifest(manifest({ entries: [] }), SECRET);
    expect(await verifyBuildManifest(token, SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("survives a 500-photo manifest", async () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      key: `galleries/abc/${i}.jpg`,
      name: `svatba_${i}.jpg`,
      size: 16_000_000,
      crc32: "aabbccdd",
    }));
    const token = await signBuildManifest(manifest({ entries }), SECRET);
    const result = await verifyBuildManifest(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.entries).toHaveLength(500);
  });
});
