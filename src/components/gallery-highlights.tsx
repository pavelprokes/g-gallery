"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { edgeMask, ScrollArrow, useSideScroll } from "@/components/chapter-nav";
import type { GalleryHighlight } from "@/lib/gallery-highlights";
import type { SignedImageGrant } from "@/lib/image-signing";
import { srcFor } from "@/lib/image-src";
import { placeholderStyle } from "@/lib/placeholder";

/** Tile height; tiles are as wide as their photo's aspect makes them. */
const HEIGHT_PX = { phone: 160, wide: 224 };

/** Photos uploaded before dimensions were captured fall back to 3:2, as in the grid. */
const FALLBACK_ASPECT = 1.5;

/**
 * The highlights: a short "best of the day" above the grid (docs/HIGHLIGHTS.md).
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
  const { scrollerRef, more, page } = useSideScroll<HTMLUListElement>(highlights, {
    // A 160–224 px strip at the top of the page: the pointer rests on it while
    // the viewer wheels down, and the page must scroll, not the strip.
    wheelSideways: false,
  });

  return (
    <section aria-labelledby={headingId} className="mb-4">
      <div className="px-4 sm:px-3">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t("highlightsTitle")}
        </h2>
        <p className="text-body text-brand-ink/70 dark:text-brand-tint/70 mt-0.5">
          {t("highlightsHint")}
        </p>
      </div>
      <div className="mt-3 flex items-center">
        {more.before && <ScrollArrow side="before" onClick={() => page(-1)} />}
        <ul
          ref={scrollerRef}
          className="flex min-w-0 flex-1 snap-x snap-proximity scroll-px-4 [scrollbar-width:none] gap-1 overflow-x-auto px-4 sm:scroll-px-3 sm:px-3 [&::-webkit-scrollbar]:hidden"
          style={{ maskImage: edgeMask(more), WebkitMaskImage: edgeMask(more) }}
        >
          {highlights.map((photo, i) => (
            <HighlightTile
              key={photo.id}
              photo={photo}
              imageGrant={imageGrant}
              busy={jumpingTo === photo.id}
              // The strip is the first thing on the page; its first few tiles
              // are what the viewer sees before anything else loads.
              priority={i < 3}
              label={t("highlightOpen", { fileName: photo.fileName })}
              onJump={onJump}
            />
          ))}
        </ul>
        {more.after && <ScrollArrow side="after" onClick={() => page(1)} />}
      </div>
    </section>
  );
}

function HighlightTile({
  photo,
  imageGrant,
  busy,
  priority,
  label,
  onJump,
}: {
  photo: GalleryHighlight;
  imageGrant: SignedImageGrant | null;
  busy: boolean;
  priority: boolean;
  label: string;
  onJump: (photoId: string) => void;
}) {
  // Same fallback as a grid tile: a missing browser-made thumbnail falls back
  // to a transformation of the original.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const aspect = photo.width && photo.height ? photo.width / photo.height : FALLBACK_ASPECT;

  return (
    <li className="shrink-0 snap-start">
      <button
        type="button"
        onClick={() => onJump(photo.id)}
        aria-label={label}
        aria-busy={busy || undefined}
        className={`on-media relative block h-40 overflow-hidden rounded-sm sm:h-56 ${
          busy ? "cursor-progress" : ""
        }`}
        style={{ aspectRatio: aspect, backgroundColor: placeholderStyle(photo.placeholder) }}
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
          sizes={`(min-width: 640px) ${Math.ceil(HEIGHT_PX.wide * aspect)}px, ${Math.ceil(
            HEIGHT_PX.phone * aspect,
          )}px`}
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
