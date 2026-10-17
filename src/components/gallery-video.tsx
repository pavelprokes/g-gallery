"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { durationParts, formatDuration, type GalleryVideo } from "@/lib/media";
import { formatBytes } from "@/lib/offline";
import { placeholderStyle } from "@/lib/placeholder";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { CloseIcon } from "@/components/ui/icons";

/**
 * Video in the gallery (docs/VIDEO.md §4). Everything here draws a video as
 * its poster through the image loader until the viewer asks for playback —
 * the grid never mounts a `<video>`, so scrolling past a film downloads a
 * JPEG, never the MP4.
 */

/** Past this without `loadeddata`, the film is treated as unplayable here. */
const PLAYABLE_TIMEOUT_MS = 10_000;

/** Same thresholds as the photo lightbox's swipe (gallery-view.tsx). */
const SWIPE_MIN_PX = 50;
const DISMISS_MIN_PX = 100;

export function PlayIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

/** "1 minuta 42 sekund" — the duration as a screen reader should say it. */
export function useSpokenDuration() {
  const t = useTranslations("gallery");
  return (ms: number | null) => {
    if (ms === null) return "";
    const { minutes, seconds } = durationParts(ms);
    return t("videoDurationSpoken", { minutes, seconds });
  };
}

/**
 * The ▶ + duration chip on a grid tile. `bg-black/60` keeps the white text
 * readable on a white poster (a dress, a sky). Purely visual: the tile's own
 * label already says "play video, 1 minute 42 seconds".
 */
export function VideoBadge({ durationMs }: { durationMs: number | null }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white tabular-nums"
    >
      <PlayIcon className="h-3.5 w-3.5" />
      {durationMs !== null && formatDuration(durationMs)}
    </span>
  );
}

interface LightboxVideoProps {
  video: GalleryVideo;
  posterSrc: string;
  placeholder: string | null;
  /** Lets the gallery's Space/K shortcut reach the element. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Shown in the "can't play here" state; null when downloads are off. */
  onDownload: (() => void) | null;
  onSwipe: (direction: 1 | -1) => void;
  onDismiss: () => void;
  onTap: () => void;
}

/**
 * The player inside the lightbox. Native controls, because they are the ones
 * every viewer already knows how to scrub, fullscreen and AirPlay — and they
 * sit on their own layer: pointer events on the `<video>` never reach the
 * swipe handling, so dragging the scrubber is never a swipe to the next photo.
 * The black area around the film still swipes, and swipes down to close.
 *
 * Keyed by item id in the parent, so moving to another item unmounts this —
 * which is what pauses the film.
 */
export function LightboxVideo({
  video,
  posterSrc,
  placeholder,
  videoRef,
  onDownload,
  onSwipe,
  onDismiss,
  onTap,
}: LightboxVideoProps) {
  const t = useTranslations("gallery");
  const [failed, setFailed] = useState(false);
  const loadedRef = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  // `preload="metadata"` loads only the header, so `loadeddata` is not
  // guaranteed before the viewer presses play on every browser. The timer is
  // therefore armed on the first play attempt, not on mount — a film nobody
  // starts is never declared broken.
  const [playRequested, setPlayRequested] = useState(false);
  useEffect(() => {
    if (!playRequested || failed) return;
    const timer = setTimeout(() => {
      if (!loadedRef.current) setFailed(true);
    }, PLAYABLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [playRequested, failed]);

  return (
    <div
      className="relative flex h-full w-full touch-pan-y items-center justify-center bg-black select-none"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onTap();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        start.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
          onSwipe(dx < 0 ? 1 : -1);
        } else if (dy >= DISMISS_MIN_PX) {
          onDismiss();
        }
      }}
    >
      {failed ? (
        <div className="relative flex h-full w-full items-center justify-center">
          <Image
            alt=""
            src={posterSrc}
            fill
            sizes="100vw"
            className="object-contain opacity-60"
            style={{ backgroundColor: placeholderStyle(placeholder) }}
          />
          <div
            role="status"
            className="relative mx-4 flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-black/75 px-5 py-4 text-center text-white"
          >
            <p className="text-sm">{t("videoCannotPlay")}</p>
            {onDownload && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload();
                }}
                className="on-media min-h-11 rounded-full bg-white px-4 text-sm font-medium text-black"
              >
                {video.sizeBytes !== null
                  ? t("videoDownloadSized", { size: formatBytes(video.sizeBytes) })
                  : t("videoDownload")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          // The poster goes through the image loader like any photo; the MP4
          // is the bucket object itself, Range requests and all.
          poster={posterSrc}
          src={video.url}
          controls
          playsInline
          preload="metadata"
          // Without this a long-pressed film offers "save video" over a
          // gallery where downloads may be switched off; the download button
          // is the sanctioned way out.
          controlsList="nodownload"
          onContextMenu={(event) => event.preventDefault()}
          onPlay={() => setPlayRequested(true)}
          onLoadedData={() => {
            loadedRef.current = true;
          }}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full"
        />
      )}
    </div>
  );
}

/**
 * The featured film: one per gallery, a large card above the highlights. It
 * opens the player directly — a deliberate exception to the highlights' "jump
 * into the grid" rule (docs/HIGHLIGHTS.md), because a film is watched, not
 * found. The film keeps its own place in the grid as well.
 */
export function FeaturedFilm({
  posterSrc,
  placeholder,
  width,
  height,
  durationMs,
  onOpen,
}: {
  posterSrc: string;
  placeholder: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  onOpen: () => void;
}) {
  const t = useTranslations("gallery");
  const spoken = useSpokenDuration();
  // A vertical phone clip as the film would fill the screen; the card stays
  // landscape and letterboxes it instead.
  const aspect = width && height && width >= height ? width / height : 16 / 9;
  return (
    <section aria-label={t("featuredFilm")} className="px-4 pt-2 pb-4 sm:px-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("playFeaturedFilm", { duration: spoken(durationMs) })}
        className="group on-media relative block w-full overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: aspect, maxHeight: "70vh" }}
      >
        <Image
          alt=""
          src={posterSrc}
          fill
          sizes="(min-width: 1024px) 1024px, 100vw"
          priority
          className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
          style={{ backgroundColor: placeholderStyle(placeholder) }}
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"
        />
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-110"
        >
          <PlayIcon className="ms-1 h-7 w-7" />
        </span>
        <span
          aria-hidden
          className="absolute bottom-3 left-4 flex items-baseline gap-2 text-white drop-shadow"
        >
          <span className="text-lg font-semibold">{t("featuredFilm")}</span>
          {durationMs !== null && (
            <span className="text-sm tabular-nums opacity-90">{formatDuration(durationMs)}</span>
          )}
        </span>
      </button>
    </section>
  );
}

/**
 * The featured film when its grid page is not loaded yet: the same player,
 * full screen, with only a close button — no neighbours to move to.
 */
export function FilmDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("gallery");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef, true, closeRef);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 outline-none"
      onClick={onClose}
    >
      {children}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="on-media absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
