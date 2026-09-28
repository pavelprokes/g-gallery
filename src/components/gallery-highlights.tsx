"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useState, type CSSProperties } from "react";
import type { GalleryHighlight } from "@/lib/gallery-highlights";
import type { SignedImageGrant } from "@/lib/image-signing";
import { srcFor } from "@/lib/image-src";
import { GRID_GAP } from "@/lib/justified-layout";
import { placeholderStyle } from "@/lib/placeholder";

/** Photos uploaded before dimensions were captured fall back to 3:2, as in the grid. */
const FALLBACK_ASPECT = 1.5;

/** How far past its target a tile may grow to fill a row (see the tile). */
const MAX_GROWTH = 1.6;

/**
 * The highlights: a short "best of the day" above the grid (docs/HIGHLIGHTS.md).
 *
 * Laid out like the grid — justified rows, uncropped, edge to edge, the
 * grid's gap — only larger, so the day's best reads as the opening of the
 * gallery rather than as a strip of thumbnails to scroll sideways through.
 *
 * Justified in CSS alone, so the server renders it exactly as it will stay:
 * each tile's flex basis and grow are both proportional to its aspect ratio,
 * so the space a row has left is shared out in proportion to width and every
 * tile in a row ends up the same height (its `aspect-ratio` sets it); a filler
 * after the last tile keeps a short final row at the target height instead of
 * stretched across. `--row` is the target row height: on a phone the width /
 * 1.45, so a 3:2 landscape (1.5) is too wide to share a row and fills it
 * alone, while two portraits (2 × 0.67) fit side by side; 260 px wider up —
 * rows then grow to fill the width, so they land a little taller: one or two
 * a row on a tablet, three to four on a desktop, the grid's tiles a size up.
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

  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2 id={headingId} className="px-4 text-xl font-semibold tracking-tight sm:px-3 sm:text-2xl">
        {t("highlightsTitle")}
      </h2>
      <ul
        className="mt-3 flex flex-wrap [--row:calc(100vw/1.45)] sm:[--row:260px]"
        style={{ gap: GRID_GAP }}
      >
        {highlights.map((photo, i) => (
          <HighlightTile
            key={photo.id}
            photo={photo}
            aspect={photo.width && photo.height ? photo.width / photo.height : FALLBACK_ASPECT}
            imageGrant={imageGrant}
            busy={jumpingTo === photo.id}
            // The highlights open the page; the first few are what the viewer
            // sees before anything else loads.
            priority={i < 3}
            label={t("highlightOpen", { fileName: photo.fileName })}
            onJump={onJump}
          />
        ))}
        {/* Takes the rest of a short last row, so its tiles keep their size. */}
        <li aria-hidden className="grow-[1000]" />
      </ul>
    </section>
  );
}

function HighlightTile({
  photo,
  aspect,
  imageGrant,
  busy,
  priority,
  label,
  onJump,
}: {
  photo: GalleryHighlight;
  aspect: number;
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
    <li
      className="min-w-0"
      style={
        {
          flexGrow: aspect,
          flexBasis: `calc(var(--row) * ${aspect})`,
          // A tile left alone on its row (a portrait before a landscape that
          // cannot join it) would grow to the full width and, keeping its
          // shape, turn several screens tall. A full row grows well under
          // this cap; a lone tile stops at it and leaves the rest empty.
          maxWidth: `calc(var(--row) * ${aspect * MAX_GROWTH})`,
          aspectRatio: aspect,
        } as CSSProperties
      }
    >
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
          // Up to a small tablet a landscape can take the whole width and a
          // portrait about half; wider up a tile is at most its capped growth.
          sizes={`(max-width: 799px) ${aspect < 1 ? 50 : 100}vw, ${Math.ceil(
            aspect * 260 * MAX_GROWTH,
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
