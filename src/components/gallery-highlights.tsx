"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GalleryHighlight } from "@/lib/gallery-highlights";
import type { SignedImageGrant } from "@/lib/image-signing";
import { srcFor } from "@/lib/image-src";
import { justifyRows } from "@/lib/justified-layout";
import { placeholderStyle } from "@/lib/placeholder";

/** Photos uploaded before dimensions were captured fall back to 3:2, as in the grid. */
const FALLBACK_ASPECT = 1.5;

/** The grid's own gap (src/components/gallery-view.tsx), so the two read as one surface. */
const GAP = 4;

/**
 * Row height the highlights aim for — the grid's tiles, a size up. On a phone
 * it follows the width: at `width / 1.3` a 3:2 landscape (1.5) fills the row
 * on its own and two portraits (2 × 0.67) share one, where the grid would
 * pair everything. Wider screens get two to three photos a row.
 */
function targetRowHeight(containerWidth: number): number {
  if (containerWidth < 640) return containerWidth / 1.3;
  if (containerWidth < 900) return 260;
  return 340;
}

/**
 * The highlights: a short "best of the day" above the grid (docs/HIGHLIGHTS.md).
 *
 * Laid out like the grid itself — justified rows, uncropped, edge to edge —
 * only larger, so the day's best reads as the opening of the gallery rather
 * than as a strip of thumbnails to scroll sideways through.
 *
 * A tile is a way *into* the gallery, not a second copy of it: tapping one
 * takes the viewer to that photo's own place in the grid, among the shots
 * around it. So nothing here opens a lightbox, and the photos never enter the
 * grid's `photos` array — the lightbox, selection, favourites and the ZIP keep
 * working on exactly what they did before.
 */
export function GalleryHighlights({
  highlights,
  imageGrant,
  jumpingTo,
  onJump,
}: {
  highlights: GalleryHighlight[];
  imageGrant: SignedImageGrant | null;
  /** The photo a jump is on its way to, while its page is still loading. */
  jumpingTo: string | null;
  onJump: (photoId: string) => void;
}) {
  const t = useTranslations("gallery");
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(0);

  // Measured before paint, so the rows appear laid out rather than jumping
  // into place a frame later.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sync = () => setWidth(el.getBoundingClientRect().width);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () =>
      justifyRows(
        highlights.map((photo) => ({
          item: photo,
          aspect: photo.width && photo.height ? photo.width / photo.height : FALLBACK_ASPECT,
        })),
        width,
        targetRowHeight(width),
        GAP,
      ),
    [highlights, width],
  );

  let index = 0;
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2 id={headingId} className="px-4 text-xl font-semibold tracking-tight sm:px-3 sm:text-2xl">
        {t("highlightsTitle")}
      </h2>
      <ul ref={listRef} className="mt-3 flex flex-col" style={{ gap: GAP }}>
        {rows.map((row) => (
          <li key={row.items[0]!.item.id}>
            <ul className="flex" style={{ gap: GAP }}>
              {row.items.map(({ item: photo, width: w, height: h }) => {
                const i = index++;
                return (
                  <HighlightTile
                    key={photo.id}
                    photo={photo}
                    width={w}
                    height={h}
                    imageGrant={imageGrant}
                    busy={jumpingTo === photo.id}
                    // The highlights open the page; the first few are what
                    // the viewer sees before anything else loads.
                    priority={i < 3}
                    label={t("highlightOpen", { fileName: photo.fileName })}
                    onJump={onJump}
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HighlightTile({
  photo,
  width,
  height,
  imageGrant,
  busy,
  priority,
  label,
  onJump,
}: {
  photo: GalleryHighlight;
  width: number;
  height: number;
  imageGrant: SignedImageGrant | null;
  busy: boolean;
  priority: boolean;
  label: string;
  onJump: (photoId: string) => void;
}) {
  // Same fallback as a grid tile: a missing browser-made thumbnail falls back
  // to a transformation of the original.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  return (
    <li className="shrink-0" style={{ width, height }}>
      <button
        type="button"
        onClick={() => onJump(photo.id)}
        aria-label={label}
        aria-busy={busy || undefined}
        className={`on-media relative block h-full w-full overflow-hidden ${
          busy ? "cursor-progress" : ""
        }`}
        style={{ backgroundColor: placeholderStyle(photo.placeholder) }}
      >
        <Image
          // The button is what a screen reader announces; see its label.
          alt=""
          src={srcFor(
            thumbnailFailed ? photo.objectKey : (photo.thumbObjectKey ?? photo.objectKey),
            imageGrant,
          )}
          onError={() => setThumbnailFailed(true)}
          fill
          sizes={`${Math.ceil(width)}px`}
          priority={priority}
          className="duration-toggle object-cover transition-transform hover:scale-105"
        />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <span
              aria-hidden
              className="motion-loop size-6 animate-spin rounded-full border-2 border-white border-t-transparent"
            />
          </span>
        )}
      </button>
    </li>
  );
}
