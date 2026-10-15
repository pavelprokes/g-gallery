import { describe, expect, it } from "vitest";
import { findMoov, readCreationTime, readMp4Meta, zeroLocations, blobReader } from "./mp4-meta";

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const length = 8 + payload.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  new DataView(out.buffer).setUint32(0, length);
  out.set(ascii(type), 4);
  let at = 8;
  for (const part of payload) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `mvhd` version 0: version+flags, creation, modification, timescale, duration. */
function mvhd(creationQuickTimeSeconds: number): Uint8Array {
  const body = new Uint8Array(20);
  const view = new DataView(body.buffer);
  view.setUint32(4, creationQuickTimeSeconds);
  view.setUint32(8, creationQuickTimeSeconds);
  view.setUint32(12, 1000);
  view.setUint32(16, 102_000);
  return box("mvhd", body);
}

const LOCATION = "+50.0755+014.4378+235.120/";
// 2026-06-20T14:30:00Z in QuickTime seconds.
const CREATED = Date.UTC(2026, 5, 20, 14, 30, 0) / 1000 + 2_082_844_800;

function sampleFile(): Uint8Array {
  const ftyp = box("ftyp", ascii("isom"), new Uint8Array(4), ascii("isommp41"));
  const xyz = box("©xyz", new Uint8Array([0, LOCATION.length, 0x15, 0xc7]), ascii(LOCATION));
  const moov = box("moov", mvhd(CREATED), box("udta", xyz));
  const mdat = box("mdat", new Uint8Array(4096).fill(0xab));
  // The common camera layout: media first, `moov` at the end.
  return concat(ftyp, mdat, moov);
}

describe("findMoov", () => {
  it("walks top-level boxes to the moov at the end of the file", async () => {
    const bytes = sampleFile();
    const blob = new Blob([bytes as BlobPart]);
    const moov = await findMoov(blobReader(blob), blob.size);
    expect(moov).not.toBeNull();
    expect(String.fromCharCode(...bytes.subarray(moov!.offset + 4, moov!.offset + 8))).toBe("moov");
    expect(moov!.offset + moov!.size).toBe(bytes.length);
  });

  it("gives up on something that is not an MP4 instead of guessing", async () => {
    const blob = new Blob([ascii("this is not a video at all, just text")]);
    expect(await findMoov(blobReader(blob), blob.size)).toBeNull();
  });
});

describe("readCreationTime", () => {
  it("reads mvhd's creation time from the QuickTime epoch", () => {
    const moov = box("moov", mvhd(CREATED));
    expect(readCreationTime(moov)?.toISOString()).toBe("2026-06-20T14:30:00.000Z");
  });

  it("treats an unset creation time as unknown, not as 1904", () => {
    expect(readCreationTime(box("moov", mvhd(0)))).toBeNull();
  });
});

describe("zeroLocations", () => {
  it("zeroes the digits of an ISO 6709 point, keeping its length", () => {
    const moov = box("moov", box("udta", ascii(`xx${LOCATION}yy`)));
    const patched = zeroLocations(moov)!;
    expect(patched.length).toBe(moov.length);
    const text = String.fromCharCode(...patched);
    expect(text).toContain("+00.0000+000.0000+000.000/");
    expect(text).not.toContain("50.0755");
  });

  it("returns null when there is nothing to remove", () => {
    expect(zeroLocations(box("moov", mvhd(CREATED)))).toBeNull();
  });
});

describe("readMp4Meta", () => {
  it("strips the location and reads the time, leaving the file the same size", async () => {
    const bytes = sampleFile();
    const meta = await readMp4Meta(new Blob([bytes as BlobPart], { type: "video/mp4" }));
    expect(meta.strippedLocation).toBe(true);
    expect(meta.takenAt?.toISOString()).toBe("2026-06-20T14:30:00.000Z");
    expect(meta.body.size).toBe(bytes.length);
    expect(meta.body.type).toBe("video/mp4");
    const stored = new Uint8Array(await meta.body.arrayBuffer());
    expect(String.fromCharCode(...stored)).not.toContain("50.0755");
    // The media data is untouched.
    expect(stored.subarray(40, 60)).toEqual(bytes.subarray(40, 60));
  });

  it("hands back the file untouched when it cannot be parsed", async () => {
    const blob = new Blob([ascii("garbage")], { type: "video/mp4" });
    const meta = await readMp4Meta(blob);
    expect(meta).toEqual({ takenAt: null, body: blob, strippedLocation: false });
  });
});
