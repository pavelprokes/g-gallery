"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
  const open = browsing !== null;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.showModal();
    // A modal dialog does not stop the page behind it scrolling.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  const step = (by: number) =>
    setBrowsing((now) => {
      if (!now) return now;
      const index = now.index + by;
      return index < 0 || index >= now.photos.length ? now : { ...now, index };
    });

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  };

  const photo = browsing?.photos[browsing.index];
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
          onKeyDown={onKey}
          className="fixed inset-0 m-0 size-full max-h-none max-w-none bg-black/95 p-0 text-white backdrop:bg-black/95"
        >
          <div key={browsing.index} className="absolute inset-x-0 top-14 bottom-0">
            {photo.videoUrl ? (
              <video controls preload="metadata" src={photo.videoUrl} className="size-full" />
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
                <Image
                  src={photo.objectKey}
                  alt={photo.fileName}
                  fill
                  sizes="(max-width: 640px) 640px, 960px"
                  loading="eager"
                  className="object-contain"
                />
              </>
            )}
          </div>
          <div className="absolute inset-x-0 top-0 flex h-14 items-center gap-3 px-4 text-sm">
            <p className="tabular-nums">
              {browsing.index + 1} / {browsing.photos.length}
            </p>
            <p className="min-w-0 flex-1 truncate">{photo.fileName}</p>
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
