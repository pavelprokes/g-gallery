"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import imageLoader from "@/lib/image-loader";

interface BrowsedPhoto {
  objectKey: string;
  thumbObjectKey?: string;
  fileName: string;
  videoUrl?: string;
}

const readTile = (tile: HTMLElement): BrowsedPhoto => ({
  objectKey: tile.dataset.photoKey!,
  thumbObjectKey: tile.dataset.photoThumb,
  fileName: tile.dataset.photoName!,
  videoUrl: tile.dataset.photoVideo,
});

/**
 * One photo large, and on through the others. The list is the tiles on the page
 * (`data-open-photo`, server-rendered), read when it opens, so it follows the
 * view's filters and sort with no second copy of them. Tiles keep their click
 * for selecting, so opening has its own button.
 *
 * `sizes` stops at the 1920 px variant guests' lightboxes mostly ask for: no new
 * billable width for the photographer paging through a gallery. The thumbnail
 * the grid already loaded sits underneath until the large one arrives.
 *
 * ponytail: arrows and keys, no swipe. Add it if browsing on a phone is common.
 */
export function AdminPhotoBrowser({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [browsing, setBrowsing] = useState<{ photos: BrowsedPhoto[]; index: number } | null>(null);
  /** The large image of this place in the list has arrived, or has failed. */
  const [large, setLarge] = useState<{ index: number; failed: boolean } | null>(null);
  const open = browsing !== null;

  const step = useCallback(
    (by: number) =>
      setBrowsing((now) => {
        if (!now) return now;
        const index = now.index + by;
        return index < 0 || index >= now.photos.length ? now : { ...now, index };
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    // On the window: a click on the photo, or the last ‹ going away under the
    // pointer, takes the focus out of the dialog. A focused video seeks instead.
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLVideoElement) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    // A modal dialog does not stop the page behind it scrolling.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = before;
    };
  }, [open, step]);

  const photo = browsing?.photos[browsing.index];
  const settled = browsing && large?.index === browsing.index ? large : null;
  const failed = settled?.failed ?? false;
  return (
    <div
      ref={rootRef}
      onClick={(event) => {
        const tile = (event.target as Element).closest<HTMLElement>("[data-open-photo]");
        if (!tile) return;
        const tiles = [...rootRef.current!.querySelectorAll<HTMLElement>("[data-open-photo]")];
        setBrowsing({ photos: tiles.map(readTile), index: tiles.indexOf(tile) });
      }}
    >
      {children}
      {browsing && photo && (
        <dialog
          ref={dialogRef}
          aria-label={photo.fileName}
          onClose={() => setBrowsing(null)}
          className="fixed inset-0 m-0 size-full max-h-none max-w-none bg-black/95 p-0 text-white select-text backdrop:bg-black/95"
        >
          <div key={browsing.index} className="absolute inset-x-0 top-14 bottom-0">
            {photo.videoUrl ? (
              <video
                controls
                preload="metadata"
                src={photo.videoUrl}
                // On a video's row `objectKey` is the poster (docs/VIDEO.md).
                poster={imageLoader({ src: photo.objectKey, width: 1080 })}
                className="size-full"
              />
            ) : (
              <>
                {photo.thumbObjectKey && (
                  <Image
                    src={photo.thumbObjectKey}
                    alt=""
                    fill
                    sizes="640px"
                    loading="eager"
                    className="object-contain"
                  />
                )}
                {!failed && (
                  <Image
                    src={photo.objectKey}
                    alt={photo.fileName}
                    fill
                    sizes="(max-width: 640px) 640px, 960px"
                    loading="eager"
                    onLoad={() => setLarge({ index: browsing.index, failed: false })}
                    onError={() => setLarge({ index: browsing.index, failed: true })}
                    className="object-contain"
                  />
                )}
              </>
            )}
          </div>
          <div className="absolute inset-x-0 top-0 flex h-14 items-center gap-3 px-4 text-sm">
            <p className="tabular-nums">
              {browsing.index + 1} / {browsing.photos.length}
            </p>
            <p className="min-w-0 flex-1 truncate">
              {photo.fileName}
              {/* The thumbnail underneath must not pass for the photo. */}
              {!photo.videoUrl && failed && " · velká fotka se nenačetla, tohle je jen náhled"}
              {!photo.videoUrl && !settled && " · načítám velkou fotku…"}
            </p>
            <Button variant="secondary" size="sm" onClick={() => dialogRef.current?.close()}>
              Zavřít
            </Button>
          </div>
          {browsing.index > 0 && (
            <button
              type="button"
              aria-label="Předchozí fotka"
              onClick={() => step(-1)}
              className="absolute top-1/2 left-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-2xl hover:bg-black/80"
            >
              ‹
            </button>
          )}
          {browsing.index < browsing.photos.length - 1 && (
            <button
              type="button"
              aria-label="Další fotka"
              onClick={() => step(1)}
              className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-2xl hover:bg-black/80"
            >
              ›
            </button>
          )}
        </dialog>
      )}
    </div>
  );
}
