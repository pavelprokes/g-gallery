import { DEVICE_SIZES, IMAGE_SIZES, QUALITY } from "@/lib/image-sizes";
import { isThumbKey } from "@/lib/thumbnail";
import { videoSrc } from "@/lib/video";

// Photo addresses on the public CDN, built exactly as the custom image loader
// builds them (src/lib/image-loader.ts) — same host, same parameter set — so
// a link handed to Claude is a variant the gallery already paid for, never a
// new billable transformation, and no byte passes through Vercel (CLAUDE.md
// invariant #1). The loader itself is a client module, hence the twin.

const THUMB_WIDTH = IMAGE_SIZES[0];
const PREVIEW_WIDTH = DEVICE_SIZES[2];

function base(): string | null {
  return process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "") || null;
}

function transformMode() {
  const mode = process.env.NEXT_PUBLIC_IMAGE_TRANSFORM;
  return mode === "imgproxy" || mode === "none" ? mode : "cloudflare";
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function transformed(key: string, width: number): string | null {
  const host = base();
  if (!host) return null;
  switch (transformMode()) {
    case "imgproxy":
      return `${host}/insecure/rs:fit:${width}:0/q:${QUALITY}/plain/${key}`;
    case "none":
      return `${host}/${encodeKey(key)}`;
    default:
      return `${host}/cdn-cgi/image/width=${width},quality=${QUALITY},format=auto,fit=scale-down/${key}`;
  }
}

/**
 * A file straight from the bucket's public host, as `archiveFor`
 * (src/lib/shared-gallery.ts) serves the ZIP and the loader a thumbnail.
 */
export function bucketUrl(key: string): string | null {
  const host = base();
  return host ? `${host}/${encodeKey(key)}` : null;
}

/**
 * The photographer's full-quality export, exactly as stored. On Cloudflare the
 * delivery host is the bucket's public custom domain; locally (imgproxy) the
 * original sits behind imgproxy's untouched `plain` path.
 */
export function originalUrl(key: string): string | null {
  const host = base();
  if (!host) return null;
  return transformMode() === "imgproxy" ? `${host}/insecure/plain/${key}` : bucketUrl(key);
}

/**
 * The grid tile, as the grid asks the loader for it: the browser-made
 * thumbnail when there is one — served untransformed on Cloudflare, through
 * imgproxy locally — and the original's 384 px variant otherwise.
 */
export function thumbUrl(objectKey: string, thumbObjectKey: string | null): string | null {
  const key = thumbObjectKey ?? objectKey;
  if (transformMode() === "cloudflare" && isThumbKey(key)) return bucketUrl(key);
  return transformed(key, THUMB_WIDTH);
}

/** The lightbox's own full-screen variant — big enough to judge a photo by. */
export function previewUrl(objectKey: string): string | null {
  return transformed(objectKey, PREVIEW_WIDTH);
}

export type CropFormat = "jpeg" | "webp";

export interface CropSpec {
  /** The photo's own size, which `rect` is measured in. */
  width: number;
  height: number;
  rect: { x: number; y: number; w: number; h: number };
  output: { width: number; height: number };
  format: CropFormat;
  quality: number;
}

/**
 * A cut-out of the photo at an exact size and format (photo_crop,
 * docs/MCP.md §Crops): Cloudflare trims the rectangle off the original and
 * resizes it; imgproxy crops at an offset. Each distinct one is a new billable
 * transformation, made only when asked for. Null without a transform backend.
 */
export function croppedUrl(key: string, spec: CropSpec): string | null {
  const host = base();
  if (!host) return null;
  const { rect, output } = spec;
  switch (transformMode()) {
    case "none":
      return null;
    case "imgproxy": {
      const enlarge = output.width > rect.w ? 1 : 0;
      const ext = spec.format === "jpeg" ? "jpg" : spec.format;
      return `${host}/insecure/crop:${rect.w}:${rect.h}:nowe:${rect.x}:${rect.y}/rs:fit:${output.width}:${output.height}:${enlarge}/q:${spec.quality}/f:${ext}/plain/${key}`;
    }
    default: {
      const right = spec.width - rect.x - rect.w;
      const bottom = spec.height - rect.y - rect.h;
      const trim =
        rect.x || rect.y || right || bottom ? `trim=${rect.y};${right};${bottom};${rect.x},` : "";
      return `${host}/cdn-cgi/image/${trim}width=${output.width},height=${output.height},fit=cover,quality=${spec.quality},format=${spec.format}/${key}`;
    }
  }
}

export interface MediaRow {
  objectKey: string;
  thumbObjectKey: string | null;
  videoObjectKey: string | null;
}

/** Every address of one photo or video, as the tools return them. */
export function mediaUrls(row: MediaRow) {
  return {
    thumbUrl: thumbUrl(row.objectKey, row.thumbObjectKey),
    previewUrl: previewUrl(row.objectKey),
    originalUrl: originalUrl(row.objectKey),
    ...(row.videoObjectKey ? { videoUrl: videoSrc(row.videoObjectKey) } : {}),
  };
}
