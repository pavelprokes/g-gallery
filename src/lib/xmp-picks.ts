// Reads the photographer's own culling marks from a JPEG's XMP packet —
// Lightroom's star rating, colour label and keywords — in the browser at
// upload (docs/HIGHLIGHTS.md). Only the marks that feed the gallery's
// highlights are kept; nothing else in the packet is stored.
//
// A regex over the packet rather than an XML parser: DOMParser does not exist
// in the upload worker, and the three values sit in fixed, well-known places
// (`xmp:Rating`, `xmp:Label`, `dc:subject`) in every writer that matters.

/** The APP1 identifier that marks a segment as XMP rather than EXIF. */
const XMP_SIGNATURE = "http://ns.adobe.com/xap/1.0/\0";

/** Scanned from the start of the file; Lightroom writes XMP right after EXIF. */
export const XMP_SCAN_BYTES = 512 * 1024;

/**
 * Keywords that mark a photo for the highlights, compared without case or
 * diacritics. Deliberately a short list of words nobody uses for anything
 * else — a keyword like "best" or "top" would catch someone's own tagging.
 */
const HIGHLIGHT_KEYWORDS = new Set(["highlight", "highlights", "gold", "vyber"]);

export interface XmpPicks {
  /** Lightroom stars, -1 (rejected) to 5; null when the file has none. */
  rating: number | null;
  /** Colour label as written ("Red", "Zelená" in a Czech Lightroom); null when none. */
  label: string | null;
  /** Carries one of the highlight keywords. */
  tagged: boolean;
}

function normalizeKeyword(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `prefix:Name="v"`, `prefix:Name='v'` or `<prefix:Name>v</prefix:Name>`. */
function readProperty(packet: string, name: string): string | null {
  const match = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')|<${name}>([^<]*)</${name}>`,
  ).exec(packet);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
}

/** Parses an XMP packet's text. Exported for the tests. */
export function parseXmpPicks(packet: string): XmpPicks {
  const ratingText = readProperty(packet, "xmp:Rating");
  const rating = ratingText === null ? NaN : Number(ratingText);
  const label = readProperty(packet, "xmp:Label");

  const subject = /<dc:subject>([\s\S]*?)<\/dc:subject>/.exec(packet)?.[1] ?? "";
  const keywords = [...subject.matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((m) =>
    normalizeKeyword(decodeEntities(m[1]!)),
  );

  return {
    rating: Number.isInteger(rating) ? Math.max(-1, Math.min(5, rating)) : null,
    label: label ? label.slice(0, 32) : null,
    tagged: keywords.some((keyword) => HIGHLIGHT_KEYWORDS.has(keyword)),
  };
}

/**
 * The photographer's marks from a JPEG, or null when it carries no XMP.
 * Accepts a prefix of the file — anything that covers the XMP segment works.
 */
export function readXmpPicksFromJpeg(bytes: Uint8Array): XmpPicks | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Start of scan: the image data follows, and no metadata comes after it.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;

    const start = offset + 4;
    const end = offset + 2 + length;
    if (marker === 0xe1 && end <= bytes.length) {
      const segment = bytes.subarray(start, end);
      if (startsWith(segment, XMP_SIGNATURE)) {
        const packet = new TextDecoder().decode(segment.subarray(XMP_SIGNATURE.length));
        return parseXmpPicks(packet);
      }
    }
    offset = end;
  }
  return null;
}

function startsWith(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * Browser-side wrapper: reads only the head of the file. Null when the file
 * is not a JPEG, has no XMP, or cannot be read — marks are a hint, never a
 * reason for an upload to fail.
 */
export async function readXmpPicksFromFile(file: File): Promise<XmpPicks | null> {
  if (!file.type.includes("jpeg")) return null;
  try {
    const head = new Uint8Array(await file.slice(0, XMP_SCAN_BYTES).arrayBuffer());
    return readXmpPicksFromJpeg(head);
  } catch {
    return null;
  }
}
