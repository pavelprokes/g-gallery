"use client";

// The photos of a social video in the admin's memory (docs/SOCIAL-VIDEO.md
// §6). Every picked photo is kept compressed, as fetched; only the slides on
// screen — and the next one — are decoded. Thirteen decoded 2900 px photos
// would be ~400 MB; two or three are not.

import { makeBackdrop, type BackdropCanvas, type FrameImage } from "@/lib/social-video/frame";

export interface SlidePhoto {
  id: string;
  /** The transform URL, at `sourceWidth` (src/lib/social-video/camera.ts). */
  url: string;
  width: number;
  height: number;
}

interface Decoded {
  image: ImageBitmap;
  backdrop: FrameImage | null;
}

/** A photo's bytes from the CDN. CORS, so the canvas it is drawn on stays
 * exportable (docs/SOCIAL-VIDEO.md §9.1). */
export async function fetchPhotoBytes(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`PHOTO_${response.status}`);
  return response.blob();
}

export class SlideImages {
  private readonly blobs = new Map<string, Promise<Blob>>();
  private readonly decoded = new Map<string, Promise<Decoded>>();
  private readonly ready = new Map<string, Decoded>();

  /** @param backdropSize the frame's size, a quarter of it is enough (makeBackdrop). */
  constructor(private readonly backdropSize: { width: number; height: number }) {}

  /** The photo's bytes, fetched once. */
  fetch(photo: SlidePhoto): Promise<Blob> {
    let blob = this.blobs.get(photo.id);
    if (!blob) {
      blob = fetchPhotoBytes(photo.url);
      // A failed fetch is not cached: the next attempt tries again.
      blob.catch(() => this.blobs.delete(photo.id));
      this.blobs.set(photo.id, blob);
    }
    return blob;
  }

  /** Decoded and ready to draw; decodes it if needed. */
  decode(photo: SlidePhoto): Promise<Decoded> {
    let decoded = this.decoded.get(photo.id);
    if (!decoded) {
      decoded = this.fetch(photo)
        .then((blob) => createImageBitmap(blob))
        .then((image) => {
          const entry = { image, backdrop: null };
          this.ready.set(photo.id, entry);
          return entry;
        });
      decoded.catch(() => this.decoded.delete(photo.id));
      this.decoded.set(photo.id, decoded);
    }
    return decoded;
  }

  /** Decodes `wanted` and releases every other decoded photo. */
  async keepOnly(wanted: readonly SlidePhoto[]): Promise<void> {
    const keep = new Set(wanted.map((p) => p.id));
    for (const [id, entry] of this.ready) {
      if (keep.has(id)) continue;
      entry.image.close();
      this.ready.delete(id);
      this.decoded.delete(id);
    }
    await Promise.all(wanted.map((p) => this.decode(p)));
  }

  /** The decoded photo, or null when it is not decoded right now. */
  imageOf(id: string): FrameImage | null {
    return this.ready.get(id)?.image ?? null;
  }

  /** The blurred backdrop of a `fit` slide, made on first use. */
  backdropOf(id: string, width: number, height: number): FrameImage | null {
    const entry = this.ready.get(id);
    if (!entry) return null;
    if (!entry.backdrop) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(this.backdropSize.width / 4);
      canvas.height = Math.round(this.backdropSize.height / 4);
      makeBackdrop(entry.image, width, height, canvas as unknown as BackdropCanvas);
      entry.backdrop = canvas;
    }
    return entry.backdrop;
  }

  /** Forgets one photo entirely — removed from the video. */
  drop(id: string): void {
    this.ready.get(id)?.image.close();
    this.ready.delete(id);
    this.decoded.delete(id);
    this.blobs.delete(id);
  }

  close(): void {
    for (const entry of this.ready.values()) entry.image.close();
    this.ready.clear();
    this.decoded.clear();
    this.blobs.clear();
  }
}
