import { describe, expect, it } from "vitest";
import { crc32, crc32Hex, crc32HexOfBlob, crc32Update } from "./crc32";

const encoder = new TextEncoder();

describe("crc32", () => {
  it("matches the standard check value for '123456789'", () => {
    // The canonical CRC-32/ISO-HDLC check value.
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("formats as 8-char lowercase hex", () => {
    expect(crc32Hex(encoder.encode("123456789"))).toBe("cbf43926");
    expect(crc32Hex(new Uint8Array())).toBe("00000000");
  });

  it("produces the same result chunked as in one pass", () => {
    const data = encoder.encode("the quick brown fox jumps over the lazy dog");
    let crc = 0;
    for (let i = 0; i < data.length; i += 7) {
      crc = crc32Update(data.subarray(i, i + 7), crc);
    }
    expect(crc).toBe(crc32(data));
  });

  it("streams a Blob to the same value", async () => {
    const data = encoder.encode("123456789");
    await expect(crc32HexOfBlob(new Blob([data as BlobPart]))).resolves.toBe("cbf43926");
  });
});
