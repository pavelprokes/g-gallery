"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { formatDuration } from "@/lib/video";
import { placeholderStyle } from "@/lib/placeholder";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { CloseIcon, PlayIcon } from "@/components/ui/icons";

/**
 * The featured film: one per gallery, a large card above the highlights
 * (docs/VIDEO.md §Featured film). It opens the player directly — a deliberate
 * exception to the highlights' "jump into the grid" rule (docs/HIGHLIGHTS.md),
 * because a film is watched, not looked for. The film keeps its own place in
 * the grid as well.
 */
export function FeaturedFilmCard({
  posterSrc,
  placeholder,
  width,
  height,
  durationMs,
  onOpen,
}: {
  /** The image loader's input (object key + any signed grant), as for a tile. */
  posterSrc: string;
  placeholder: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  onOpen: () => void;
}) {
  const t = useTranslations("gallery");
  const duration = durationMs !== null ? formatDuration(durationMs) : null;
  // A vertical phone clip would fill the whole screen; the card stays
  // landscape and letterboxes it instead.
  const aspect = width && height && width >= height ? width / height : 16 / 9;
  return (
    <section aria-label={t("featuredFilm")} className="px-4 pt-2 pb-4 sm:px-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("playFeaturedFilm", { duration: duration ?? "none" })}
        className="group on-media relative block max-h-[70vh] w-full overflow-hidden rounded-2xl bg-black"
        style={{ aspectRatio: aspect }}
      >
        <Image
          alt=""
          src={posterSrc}
          fill
          sizes="(min-width: 1280px) 1280px, 100vw"
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
          {duration && <span className="text-sm tabular-nums opacity-90">{duration}</span>}
        </span>
      </button>
    </section>
  );
}

/**
 * The featured film when its grid page is not loaded yet: the same player as
 * the lightbox, full screen, with a close button and nothing to move to.
 * Loading every page before it just to open the lightbox would fetch the whole
 * gallery's metadata for one tap.
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
      className="fixed inset-0 z-50 bg-black outline-none"
      onClick={onClose}
    >
      {children}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="on-media absolute top-[max(1rem,env(safe-area-inset-top))] right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
