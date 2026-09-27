// Reads the photographer's own culling marks from a JPEG's XMP packet —
// Lightroom's star rating, colour label and keywords — in the browser at
// upload (docs/HIGHLIGHTS.md). Only the marks that feed the gallery's
// highlights are kept; nothing else in the packet is stored.
//
// A regex over the packet rather than an XML parser: DOMParser does not exist
// in the upload worker, and the three values sit in fixed, well-known places
// (`xmp:Rating`, `xmp:Label`, `dc:subject`) in every writer that matters.

import { findApp1Segment, XMP_SIGNATURE } from "@/lib/exif-gps";

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
 * Accepts a prefix of the file — anything that covers the XMP segment works;
 * the upload passes the same head it reads the capture time from.
 */
export function readXmpPicksFromJpeg(bytes: Uint8Array): XmpPicks | null {
  const segment = findApp1Segment(bytes, XMP_SIGNATURE);
  if (!segment) return null;
  return parseXmpPicks(new TextDecoder().decode(bytes.subarray(segment.start, segment.end)));
}
