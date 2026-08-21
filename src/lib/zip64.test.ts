import { describe, expect, it } from "vitest";
import { archiveSize, centralHeader, endOfCentralDirectory, localHeader, zipStream } from "./zip64";
import { crc32 } from "./crc32";

const GIB = 1024 ** 3;

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  );
}
function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

const entry = { name: "a.jpg", size: 100, crc32: 0xdeadbeef };

describe("localHeader", () => {
  it("starts with the local file signature", () => {
    expect(u32(localHeader(entry), 0)).toBe(0x04034b50);
  });

  it("marks the entry stored, never deflated", () => {
    // JPEGs do not compress; deflate would cost CPU and grow the archive.
    expect(u16(localHeader(entry), 8)).toBe(0);
  });

  it("sets the UTF-8 name flag", () => {
    // Without bit 11 a name with diacritics is mojibake on Windows.
    expect(u16(localHeader(entry), 6) & 0x0800).toBe(0x0800);
  });

  it("carries the CRC before the data, which is what allows streaming", () => {
    expect(u32(localHeader(entry), 14)).toBe(0xdeadbeef);
  });

  it("writes sizes inline for a normal photo", () => {
    const header = localHeader(entry);
    expect(u32(header, 18)).toBe(100);
    expect(u32(header, 22)).toBe(100);
    expect(u16(header, 28)).toBe(0); // no extra field needed
  });

  it("moves an over-4GiB size into a ZIP64 extra field", () => {
    const header = localHeader({ name: "big.mov", size: 5 * GIB, crc32: 1 });
    expect(u32(header, 18)).toBe(0xffffffff);
    expect(u16(header, 28)).toBe(20);
    expect(u16(header, 4)).toBe(45); // version needed = 4.5
  });
});

describe("centralHeader", () => {
  it("keeps a small offset inline", () => {
    const header = centralHeader(entry, 1234);
    expect(u32(header, 0)).toBe(0x02014b50);
    expect(u32(header, 42)).toBe(1234);
    expect(u16(header, 30)).toBe(0);
  });

  it("moves an over-4GiB offset into the extra field", () => {
    // This is the case that actually fires for us: an 8 GB gallery pushes
    // later entries past the 32-bit offset limit.
    const header = centralHeader(entry, 5 * GIB);
    expect(u32(header, 42)).toBe(0xffffffff);
    expect(u16(header, 30)).toBe(12); // 4 header + 8 offset only
  });

  it("carries both size and offset when both overflow", () => {
    const header = centralHeader({ name: "x", size: 5 * GIB, crc32: 0 }, 6 * GIB);
    expect(u16(header, 30)).toBe(28); // 4 + 16 sizes + 8 offset
  });
});

describe("endOfCentralDirectory", () => {
  it("emits a plain EOCD for a small archive", () => {
    const eocd = endOfCentralDirectory(10, 500, 1000);
    expect(u32(eocd, 0)).toBe(0x06054b50);
    expect(u16(eocd, 10)).toBe(10);
    expect(eocd.length).toBe(22);
  });

  it("prepends the ZIP64 record and locator past 4GiB", () => {
    const eocd = endOfCentralDirectory(500, 50_000, 9 * GIB);
    expect(u32(eocd, 0)).toBe(0x06064b50); // ZIP64 EOCD
    expect(u32(eocd, 56)).toBe(0x07064b50); // locator
    expect(u32(eocd, 76)).toBe(0x06054b50); // classic EOCD still present
  });

  it("still writes a classic EOCD with sentinels, or extractors call it corrupt", () => {
    const eocd = endOfCentralDirectory(500, 50_000, 9 * GIB);
    expect(u16(eocd, 76 + 10)).toBe(0xffff);
    expect(u32(eocd, 76 + 16)).toBe(0xffffffff);
  });

  it("goes ZIP64 past 65535 entries even when small", () => {
    expect(u32(endOfCentralDirectory(70_000, 100, 100), 0)).toBe(0x06064b50);
  });
});

describe("archiveSize", () => {
  it("matches the bytes actually produced", async () => {
    const files = [
      { name: "one.jpg", bytes: new Uint8Array(11).fill(1) },
      { name: "two.jpg", bytes: new Uint8Array(2048).fill(2) },
      { name: "tři.jpg", bytes: new Uint8Array(7).fill(3) },
    ];
    const entries = files.map((f) => ({
      name: f.name,
      size: f.bytes.length,
      crc32: crc32(f.bytes),
    }));

    const predicted = archiveSize(entries);
    const actual = await collect(zipStream(entries, async (i) => streamOf(files[i]!.bytes)));

    // An exact Content-Length is what lets a browser show real progress and
    // notice a truncated 8 GB download.
    expect(actual.length).toBe(predicted);
  });

  it("is computed without reading any file data", () => {
    const huge = Array.from({ length: 500 }, (_, i) => ({
      name: `p${i}.jpg`,
      size: 16_000_000,
      crc32: 0,
    }));
    expect(archiveSize(huge)).toBeGreaterThan(8_000_000_000);
  });
});

describe("zipStream", () => {
  it("lays out header, data, central directory, EOCD in order", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const entries = [{ name: "a.bin", size: 4, crc32: crc32(bytes) }];
    const out = await collect(zipStream(entries, async () => streamOf(bytes)));

    expect(u32(out, 0)).toBe(0x04034b50);
    const dataAt = 30 + 5;
    expect([...out.slice(dataAt, dataAt + 4)]).toEqual([1, 2, 3, 4]);
    expect(u32(out, dataAt + 4)).toBe(0x02014b50);
  });

  it("records each entry's real offset in the central directory", async () => {
    const a = new Uint8Array(10).fill(7);
    const b = new Uint8Array(20).fill(8);
    const entries = [
      { name: "a", size: 10, crc32: crc32(a) },
      { name: "b", size: 20, crc32: crc32(b) },
    ];
    const out = await collect(zipStream(entries, async (i) => streamOf(i === 0 ? a : b)));

    // Second entry starts after the first header + its data.
    const secondOffset = 30 + 1 + 10;
    const centralStart = secondOffset + 30 + 1 + 20;
    expect(u32(out, centralStart)).toBe(0x02014b50);
    const secondCentral = centralStart + 46 + 1;
    expect(u32(out, secondCentral + 42)).toBe(secondOffset);
  });

  it("pulls file bytes lazily, one entry at a time", async () => {
    const opened: number[] = [];
    const entries = Array.from({ length: 3 }, (_, i) => ({
      name: `${i}`,
      size: 1,
      crc32: 0,
    }));
    const stream = zipStream(entries, async (i) => {
      opened.push(i);
      return streamOf(new Uint8Array([i]));
    });

    const reader = stream.getReader();
    await reader.read(); // first local header; opens entry 0 and no more
    // Peak memory is one chunk, not one file, and never the whole gallery.
    expect(opened).toEqual([0]);
    await reader.read(); // entry 0's bytes
    expect(opened).toEqual([0]);
    await reader.read(); // entry 1's header
    expect(opened).toEqual([0, 1]);
    await reader.cancel();
  });

  it("produces an empty-but-valid archive for no entries", async () => {
    const out = await collect(zipStream([], async () => streamOf(new Uint8Array())));
    expect(u32(out, 0)).toBe(0x06054b50);
    expect(out.length).toBe(22);
  });
});

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
