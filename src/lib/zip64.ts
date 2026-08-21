/**
 * Store-only streaming ZIP64 writer (docs/PLAN.md §7).
 *
 * Three decisions shape the whole thing:
 *
 * 1. **Stored, never deflated.** JPEGs do not compress; deflate would burn CPU
 *    to make the archive marginally larger. Storing also means the output size
 *    is known before a single byte is read.
 *
 * 2. **CRC32 and sizes come from the database**, captured in the browser at
 *    upload. That is what makes streaming possible: a ZIP local header must
 *    carry the CRC *before* the data, and the only alternatives are buffering
 *    each file or emitting data descriptors, which some extractors mishandle.
 *
 * 3. **Exact Content-Length.** Browsers show real progress and detect a
 *    truncated download, which matters when the archive is 8 GB over a phone
 *    connection.
 *
 * Pure byte layout, no I/O, no Node built-ins — runs in a Worker and in tests.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

/** Sentinel meaning "the real value is in the ZIP64 extra field". */
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** 2.0 for stored entries; 4.5 once any ZIP64 field is in play. */
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;

/** Bit 11: entry names are UTF-8. Without it, diacritics break on Windows. */
const FLAG_UTF8 = 0x0800;

export interface ZipEntry {
  /** Name inside the archive; must already be sanitised and unique. */
  name: string;
  size: number;
  /** CRC32 as an unsigned 32-bit number. */
  crc32: number;
}

class ByteWriter {
  private readonly bytes: number[] = [];

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  /** ZIP64 fields are 64-bit little-endian; sizes here exceed 2^32. */
  u64(value: number): this {
    const big = BigInt(value);
    for (let i = 0n; i < 8n; i += 1n) {
      this.bytes.push(Number((big >> (i * 8n)) & 0xffn));
    }
    return this;
  }

  raw(data: Uint8Array): this {
    for (const byte of data) this.bytes.push(byte);
    return this;
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

/**
 * DOS timestamp. Fixed rather than "now": a deterministic archive is
 * byte-identical across runs, which makes it testable, and the real capture
 * time lives in the EXIF the photo already carries.
 */
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 0x21; // 1980-01-01

/** Only the offset can overflow 32 bits here — individual photos are far under 4 GiB. */
function needsZip64Offset(offset: number): boolean {
  return offset >= U32_MAX;
}

function needsZip64Size(size: number): boolean {
  return size >= U32_MAX;
}

export function localHeader(entry: ZipEntry): Uint8Array {
  const name = encodeName(entry.name);
  const zip64 = needsZip64Size(entry.size);

  const writer = new ByteWriter()
    .u32(LOCAL_SIG)
    .u16(zip64 ? VERSION_ZIP64 : VERSION_STORE)
    .u16(FLAG_UTF8)
    .u16(0) // stored
    .u16(DOS_TIME)
    .u16(DOS_DATE)
    .u32(entry.crc32)
    .u32(zip64 ? U32_MAX : entry.size) // compressed
    .u32(zip64 ? U32_MAX : entry.size) // uncompressed
    .u16(name.length)
    .u16(zip64 ? 20 : 0)
    .raw(name);

  if (zip64) {
    writer.u16(0x0001).u16(16).u64(entry.size).u64(entry.size);
  }
  return writer.done();
}

export function centralHeader(entry: ZipEntry, offset: number): Uint8Array {
  const name = encodeName(entry.name);
  const bigSize = needsZip64Size(entry.size);
  const bigOffset = needsZip64Offset(offset);
  const zip64 = bigSize || bigOffset;

  // The extra field carries only the fields that actually overflowed, in the
  // fixed order size, compressed size, offset — extractors rely on that order.
  const extraLength = zip64 ? 4 + (bigSize ? 16 : 0) + (bigOffset ? 8 : 0) : 0;

  const writer = new ByteWriter()
    .u32(CENTRAL_SIG)
    .u16(zip64 ? VERSION_ZIP64 : VERSION_STORE) // version made by
    .u16(zip64 ? VERSION_ZIP64 : VERSION_STORE) // version needed
    .u16(FLAG_UTF8)
    .u16(0) // stored
    .u16(DOS_TIME)
    .u16(DOS_DATE)
    .u32(entry.crc32)
    .u32(bigSize ? U32_MAX : entry.size)
    .u32(bigSize ? U32_MAX : entry.size)
    .u16(name.length)
    .u16(extraLength)
    .u16(0) // comment length
    .u16(0) // disk number
    .u16(0) // internal attributes
    .u32(0) // external attributes
    .u32(bigOffset ? U32_MAX : offset)
    .raw(name);

  if (zip64) {
    writer.u16(0x0001).u16(extraLength - 4);
    if (bigSize) writer.u64(entry.size).u64(entry.size);
    if (bigOffset) writer.u64(offset);
  }
  return writer.done();
}

/**
 * ZIP64 end-of-central-directory record, its locator, and the classic EOCD.
 *
 * The classic EOCD is always emitted with sentinel values when ZIP64 applies:
 * every extractor looks for it first, and an archive without one is treated as
 * corrupt even by tools that understand ZIP64.
 */
export function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array {
  const zip64 = entryCount > U16_MAX || centralSize >= U32_MAX || centralOffset >= U32_MAX;

  const writer = new ByteWriter();

  if (zip64) {
    writer
      .u32(ZIP64_EOCD_SIG)
      .u64(44) // size of this record minus 12
      .u16(VERSION_ZIP64)
      .u16(VERSION_ZIP64)
      .u32(0) // this disk
      .u32(0) // disk with central directory
      .u64(entryCount)
      .u64(entryCount)
      .u64(centralSize)
      .u64(centralOffset);

    writer
      .u32(ZIP64_LOCATOR_SIG)
      .u32(0) // disk with ZIP64 EOCD
      .u64(centralOffset + centralSize)
      .u32(1); // total disks
  }

  writer
    .u32(EOCD_SIG)
    .u16(0)
    .u16(0)
    .u16(zip64 ? U16_MAX : entryCount)
    .u16(zip64 ? U16_MAX : entryCount)
    .u32(zip64 ? U32_MAX : centralSize)
    .u32(zip64 ? U32_MAX : centralOffset)
    .u16(0); // comment length

  return writer.done();
}

/**
 * Exact byte length of the finished archive.
 *
 * Computed by laying the whole thing out without reading any file data, which
 * is what lets the response carry a real Content-Length.
 */
export function archiveSize(entries: readonly ZipEntry[]): number {
  let offset = 0;
  const offsets: number[] = [];

  for (const entry of entries) {
    offsets.push(offset);
    offset += localHeader(entry).length + entry.size;
  }

  const centralOffset = offset;
  let centralSize = 0;
  entries.forEach((entry, index) => {
    centralSize += centralHeader(entry, offsets[index]!).length;
  });

  return (
    centralOffset +
    centralSize +
    endOfCentralDirectory(entries.length, centralSize, centralOffset).length
  );
}

/**
 * Streams the archive, pulling each entry's bytes only when it is that entry's
 * turn — so peak memory is one chunk, not one file and certainly not 8 GB.
 *
 * `open` is given the entry index and must resolve to that file's bytes.
 */
export function zipStream(
  entries: readonly ZipEntry[],
  open: (index: number) => Promise<ReadableStream<Uint8Array>>,
): ReadableStream<Uint8Array> {
  let index = 0;
  let offset = 0;
  const offsets: number[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Loops until it enqueues or closes. A pull() that returns having done
      // neither is not guaranteed to be called again, and the stream stalls —
      // which is exactly what happened when finishing one file simply advanced
      // the index and returned.
      for (;;) {
        if (finished) return;

        if (reader === null) {
          if (index >= entries.length) {
            const centralOffset = offset;
            let centralSize = 0;
            for (let i = 0; i < entries.length; i += 1) {
              const header = centralHeader(entries[i]!, offsets[i]!);
              controller.enqueue(header);
              centralSize += header.length;
            }
            controller.enqueue(endOfCentralDirectory(entries.length, centralSize, centralOffset));
            controller.close();
            finished = true;
            return;
          }

          const entry = entries[index]!;
          offsets.push(offset);
          const header = localHeader(entry);
          controller.enqueue(header);
          offset += header.length;
          // Opened only now, so exactly one file is ever in flight.
          reader = (await open(index)).getReader();
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          index += 1;
          // Round again: the next header or the central directory.
          continue;
        }
        controller.enqueue(value);
        offset += value.length;
        return;
      }
    },

    async cancel(reason) {
      // The viewer closed the tab mid-download; stop pulling from R2.
      await reader?.cancel(reason);
    },
  });
}
