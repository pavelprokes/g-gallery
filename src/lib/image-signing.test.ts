import { describe, expect, it } from "vitest";
import {
  keyInGrant,
  signImageAccess,
  verifyImageAccess,
  type ImageAccessGrant,
} from "./image-signing";

const SECRET = "image-signing-secret-at-least-32-chars!!";

function grant(over: Partial<ImageAccessGrant> = {}): ImageAccessGrant {
  return {
    prefix: "galleries/abc123",
    exp: Math.floor(Date.now() / 1000) + 7200,
    ...over,
  };
}

describe("image access grant signing", () => {
  it("round-trips a valid grant", async () => {
    const token = await signImageAccess(grant(), SECRET);
    const result = await verifyImageAccess(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.grant.prefix).toBe("galleries/abc123");
  });

  it("rejects a grant signed with a different secret", async () => {
    const token = await signImageAccess(grant(), SECRET);
    expect(await verifyImageAccess(token, "some-other-secret-value-here!!!!")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered prefix", async () => {
    // The whole point: a viewer must not be able to widen a grant to another gallery.
    const token = await signImageAccess(grant(), SECRET);
    const [payload, signature] = token.split(".");
    const evil = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as ImageAccessGrant;
    evil.prefix = "galleries/victim";
    const forged = `${Buffer.from(JSON.stringify(evil)).toString("base64url")}.${signature}`;

    expect(await verifyImageAccess(forged, SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired grant", async () => {
    const token = await signImageAccess(grant({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);
    expect(await verifyImageAccess(token, SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const bad of ["", ".", "abc", "abc.", ".abc", "not-base64!.also-not"]) {
      const result = await verifyImageAccess(bad, SECRET);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a grant with an empty prefix", async () => {
    const token = await signImageAccess(grant({ prefix: "" }), SECRET);
    expect(await verifyImageAccess(token, SECRET)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("keyInGrant", () => {
  it("accepts a key nested under the prefix", () => {
    expect(keyInGrant("galleries/abc123/photo.jpg", grant())).toBe(true);
  });

  it("accepts the bare prefix itself", () => {
    expect(keyInGrant("galleries/abc123", grant())).toBe(true);
  });

  it("rejects a key that only shares a string prefix, not a path segment", () => {
    // "galleries/abc123" must not authorise "galleries/abc123456/…".
    expect(keyInGrant("galleries/abc123456/photo.jpg", grant())).toBe(false);
  });

  it("rejects a key under a different gallery", () => {
    expect(keyInGrant("galleries/other/photo.jpg", grant())).toBe(false);
  });
});
