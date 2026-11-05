import "server-only";
import { deflateSync } from "node:zlib";
import { thumbHashToRGBA } from "thumbhash";
import { crc32 } from "@/lib/crc32";
import { isThumbhash } from "@/lib/thumbhash";

/**
 * The blur as a compressed PNG data URL, for what the server draws into the
 * HTML (the highlights, a photo link's frame).
 *
 * The browser's own `thumbHashToDataURL` stores the pixels uncompressed —
 * there is no synchronous deflate in a browser — which is ~4.2 kB a blur, ~2.1
 * kB even after the page's gzip: six highlights would add ~13 kB to the HTML a
 * slow phone reads before anything else. Here zlib is at hand, and a blur is a
 * smooth gradient: with each row stored as its difference from the one above
 * (PNG filter "Up") it deflates to a few hundred bytes. Same pixels, same
 * picture.
 *
 * Each goes out twice, in the tile's `style` and in the client component's RSC
 * props, and it cannot be once: whatever a component renders is in both, a
 * server-rendered `<style>` included. Measured on six highlights, the second
 * copies are 6.1 kB raw, 3.2 kB with gzip (they lie further apart than its 32 kB
 * window) and 37 bytes with the Brotli Vercel serves.
 */
export function thumbhashPngDataUrl(value: string | null | undefined): string | null {
  if (!value || !isThumbhash(value)) return null;
  try {
    const { w, h, rgba } = thumbHashToRGBA(Buffer.from(value, "base64"));
    const opaque = rgba.every((byte, i) => i % 4 !== 3 || byte === 255);
    const channels = opaque ? 3 : 4;
    const stride = w * channels;
    const raw = Buffer.alloc((stride + 1) * h);
    const row = Buffer.alloc(stride);
    let previous = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < channels; c++) row[x * channels + c] = rgba[(y * w + x) * 4 + c]!;
      }
      const at = y * (stride + 1);
      raw[at] = 2; // filter: Up
      for (let i = 0; i < stride; i++) raw[at + 1 + i] = (row[i]! - previous[i]!) & 0xff;
      previous = Buffer.from(row);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8; // bit depth
    header[9] = opaque ? 2 : 6; // colour type: RGB or RGBA
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}
