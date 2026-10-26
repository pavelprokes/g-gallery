import "server-only";
import { shrink } from "@/lib/photo-crop";

// Keeps a delivered crop under a byte limit (photo_crop, docs/MCP.md §Crops):
// Instagram and Facebook refuse images over 8 MB. Nothing can tell a JPEG's
// size before it is made, so the transformed address is asked with HEAD — the
// CDN answers with the size and no body, so no image byte reaches Vercel
// (CLAUDE.md invariant #1) — and quality, then size, step down until it fits,
// starting from the size asked for so nothing comes out smaller than it must.

export type SizeOf = (url: string) => Promise<number | null>;

export interface Fitted {
  url: string;
  output: { width: number; height: number };
  quality: number;
  /** Measured size; null when the CDN could not be asked. */
  bytes: number | null;
  fits: boolean;
}

/** Below this the quality step is not worth it — the size goes down instead. */
const QUALITY_FLOOR = 70;
const QUALITY_STEP = 10;
/** Room under the limit after shrinking: a JPEG's size is not exactly linear in pixels. */
const SHRINK_MARGIN = 0.9;
const MAX_ATTEMPTS = 5;
const HEAD_TIMEOUT_MS = 15_000;

/** The size the CDN reports for an address, without its body. */
export const headSize: SizeOf = async (url) => {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/"))
      return null;
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
};

export async function fitBytes(
  build: (output: { width: number; height: number }, quality: number) => string,
  start: { width: number; height: number },
  startQuality: number,
  maxBytes: number,
  sizeOf: SizeOf = headSize,
): Promise<Fitted> {
  let output = start;
  let quality = startQuality;
  let last: Fitted | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const url = build(output, quality);
    const bytes = await sizeOf(url);
    last = { url, output, quality, bytes, fits: bytes !== null && bytes <= maxBytes };
    if (bytes === null || bytes <= maxBytes) return last;
    const ratio = maxBytes / bytes;
    if (ratio > 0.75 && quality - QUALITY_STEP >= QUALITY_FLOOR) {
      quality -= QUALITY_STEP;
    } else {
      output = shrink(output, Math.sqrt(ratio) * SHRINK_MARGIN);
    }
  }
  return last!;
}
