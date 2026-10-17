import { describe, expect, it } from "vitest";
import { inspectMoov, inspectMp4, isH264 } from "./mp4-inspect";

type Bytes = Uint8Array<ArrayBuffer>;

function box(type: string, ...children: Uint8Array[]): Bytes {
  const body = concat(...children);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const ascii = (text: string): Bytes => new Uint8Array(new TextEncoder().encode(text));

/** Version-0 `mvhd` whose creation time is `unixSeconds`. */
function mvhd(unixSeconds: number): Bytes {
  const body = new Uint8Array(100);
  new DataView(body.buffer).setUint32(4, unixSeconds === 0 ? 0 : unixSeconds + 2_082_844_800);
  return box("mvhd", body);
}

/** `mvhd` version 1: 64-bit times. */
function mvhdV1(unixSeconds: number): Bytes {
  const body = new Uint8Array(112);
  body[0] = 1;
  new DataView(body.buffer).setBigUint64(4, BigInt(unixSeconds + 2_082_844_800));
  return box("mvhd", body);
}

const ftyp = box("ftyp", ascii("isom\0\0\x02\0isomiso2avc1mp41"));
const mdat = box("mdat", new Uint8Array(4096));

describe("inspectMoov", () => {
  it("reads the creation time from mvhd, both versions", () => {
    const at = Date.UTC(2026, 8, 5, 14, 30) / 1000;
    expect(inspectMoov(box("moov", mvhd(at))).createdAt?.toISOString()).toBe(
      "2026-09-05T14:30:00.000Z",
    );
    expect(inspectMoov(box("moov", mvhdV1(at))).createdAt?.toISOString()).toBe(
      "2026-09-05T14:30:00.000Z",
    );
  });

  it("treats a zero creation time as unknown", () => {
    expect(inspectMoov(box("moov", mvhd(0))).createdAt).toBeNull();
  });

  it("finds a ©xyz location box in user data", () => {
    const xyz = new Uint8Array(box("XXXX", ascii("+50.0755+014.4378/")));
    // Rename the placeholder type to ©xyz (non-ASCII first byte).
    xyz[4] = 0xa9;
    xyz.set(ascii("xyz"), 5);
    const moov = box("moov", mvhd(1), box("udta", xyz));
    expect(inspectMoov(moov).hasLocation).toBe(true);
  });

  it("finds a location written under any key, by its ISO 6709 value", () => {
    // Apple's `mdta` key, and ffmpeg's plain `location` (use_metadata_tags).
    for (const key of ["com.apple.quicktime.location.ISO6709", "location"]) {
      const meta = box(
        "meta",
        box("keys", ascii("mdta" + key)),
        box("ilst", ascii("data\0\0\0\x01\0\0\0\0+50.0755+014.4378+235.000/")),
      );
      expect(inspectMoov(box("moov", mvhd(1), meta)).hasLocation).toBe(true);
    }
    // Southern and western hemispheres, no decimals on the degrees.
    const west = box("udta", ascii("-33.8688-151/"));
    expect(inspectMoov(box("moov", mvhd(1), west)).hasLocation).toBe(true);
  });

  it("does not mistake the same four bytes inside a table for a location box", () => {
    // ©xyz preceded by a size that runs past the end of moov: just data.
    const table = new Uint8Array(32);
    new DataView(table.buffer).setUint32(8, 0x7fffffff);
    table.set([0xa9, 0x78, 0x79, 0x7a], 12);
    expect(inspectMoov(box("moov", mvhd(1), box("stsz", table))).hasLocation).toBe(false);
  });

  it("reports no location for a clean export", () => {
    expect(inspectMoov(box("moov", mvhd(1), box("trak", new Uint8Array(64)))).hasLocation).toBe(
      false,
    );
  });
});

/** moov/trak/mdia/minf/stbl/stsd with one sample entry of `codec`. */
function trackWith(codec: string, width = 1920, height = 1080): Bytes {
  const stsdBody = new Uint8Array(8);
  new DataView(stsdBody.buffer).setUint32(4, 1);
  const entry = new Uint8Array(78);
  new DataView(entry.buffer).setUint16(24, width);
  new DataView(entry.buffer).setUint16(26, height);
  const stsd = box("stsd", stsdBody, box(codec, entry));
  return box("trak", box("mdia", box("minf", box("stbl", stsd))));
}

describe("video codec", () => {
  it("finds the video track's sample entry, skipping the audio one", () => {
    const moov = box("moov", mvhd(1), trackWith("mp4a"), trackWith("avc1"));
    expect(inspectMoov(moov).videoCodec).toBe("avc1");
    expect(inspectMoov(box("moov", mvhd(1), trackWith("hvc1"))).videoCodec).toBe("hvc1");
  });

  it("reads the coded size from the sample entry", () => {
    const moov = box("moov", mvhd(1), trackWith("mp4a"), trackWith("avc1", 3840, 2160));
    const facts = inspectMoov(moov);
    expect([facts.videoWidth, facts.videoHeight]).toEqual([3840, 2160]);
  });

  it("is null without a video track", () => {
    expect(inspectMoov(box("moov", mvhd(1), trackWith("mp4a"))).videoCodec).toBeNull();
  });

  it("accepts H.264 only", () => {
    expect(isH264("avc1")).toBe(true);
    expect(isH264("avc3")).toBe(true);
    expect(isH264("hvc1")).toBe(false);
    expect(isH264(null)).toBe(false);
  });
});

describe("inspectMp4", () => {
  const at = Date.UTC(2026, 9, 17) / 1000;

  it("finds moov at the front (faststart) and at the back", async () => {
    const moov = box("moov", mvhd(at));
    const front = await inspectMp4(new Blob([concat(ftyp, moov, mdat)]));
    const back = await inspectMp4(new Blob([concat(ftyp, mdat, moov)]));
    expect(front?.createdAt?.getTime()).toBe(at * 1000);
    expect(back?.createdAt?.getTime()).toBe(at * 1000);
  });

  it("follows a 64-bit box size", async () => {
    const big = new Uint8Array(16 + 32);
    const view = new DataView(big.buffer);
    view.setUint32(0, 1);
    big.set(ascii("mdat"), 4);
    view.setBigUint64(8, BigInt(big.length));
    const facts = await inspectMp4(new Blob([concat(ftyp, big, box("moov", mvhd(at)))]));
    expect(facts?.createdAt?.getTime()).toBe(at * 1000);
  });

  it("returns null for something that is not an MP4", async () => {
    expect(await inspectMp4(new Blob([ascii("definitely not a video file at all")]))).toBeNull();
    expect(await inspectMp4(new Blob([concat(ftyp, mdat)]))).toBeNull();
  });
});
