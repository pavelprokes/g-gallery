// CRC32 (IEEE 802.3, the variant ZIP uses). Computed in the browser during
// upload and stored on Photo.crc32 so the future ZIP Worker can emit complete
// local file headers without ever hashing the 6GB itself (docs/PLAN.md §7).

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Feed chunks incrementally; start with `undefined` and pass the result back. */
export function crc32Update(chunk: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < chunk.length; i++) {
    crc = (TABLE[(crc ^ chunk[i]!)! & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  return crc32Update(bytes);
}

/** Lowercase 8-char hex, the form stored in Postgres. */
export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, "0");
}

/** Streams a File through CRC32 without holding the whole 12MB in memory twice. */
export async function crc32HexOfBlob(blob: Blob): Promise<string> {
  // jsdom (and older Safari) lack Blob.stream(); fall back to a single read.
  if (typeof blob.stream !== "function") {
    return crc32Hex(new Uint8Array(await blob.arrayBuffer()));
  }

  const reader = blob.stream().getReader();
  let crc = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crc32Update(value, crc);
  }
  return crc.toString(16).padStart(8, "0");
}
