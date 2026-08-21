"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  dismissNamePrompt,
  getOptOutServerSnapshot,
  getOptOutSnapshot,
  getViewerId,
  getViewerName,
  hasAnsweredNamePrompt,
  optOut,
  setViewerName,
  subscribeOptOut,
} from "@/lib/viewer-id";
import { PresenceStrip } from "@/components/presence-strip";
import {
  clearSelection,
  EMPTY_SELECTION,
  isAllSelected,
  selectAll,
  selectedInOrder,
  selectRange,
  toggleOne,
} from "@/lib/selection";
import { FORMS, pluralize } from "@/lib/czech-plural";
import imageLoader from "@/lib/image-loader";
import { fullWidthSrcSet } from "@/lib/image-sizes";
import { placeholderStyle } from "@/lib/placeholder";
import { OfflineToggle } from "@/components/offline-toggle";
import {
  REACTION_EMOJI,
  REACTION_KINDS,
  REACTION_LABEL,
  totalReactions,
  type PhotoReactionState,
  type ReactionKind,
} from "@/lib/reactions-shared";

/** Distance a touch must travel before it counts as a swipe, not a tap. */
const SWIPE_THRESHOLD_PX = 50;

/** Beyond this the gesture is a scroll, not a horizontal swipe. */
const SWIPE_MAX_VERTICAL_PX = 80;

/** Long press to enter selection mode on touch. Matches the platform feel. */
const LONG_PRESS_MS = 450;

export interface GalleryPhoto {
  id: string;
  objectKey: string;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  favoriteCount: number;
}

/**
 * How many tiles load eagerly. Everything else is lazy, which is what keeps a
 * 500-photo gallery from fetching 500 images at once — but leaving the first
 * row lazy too means the photos the viewer is actually looking at wait for the
 * lazy-load trigger before they even start.
 */
const EAGER_TILES = 6;

export interface GalleryViewer {
  id: string;
  displayName: string;
}

/** Heartbeat cadence while the tab is visible; also keeps Supabase awake. */
const HEARTBEAT_MS = 5 * 60 * 1000;

/** Target row height the justified layout aims for (see `flexBasis` below). */
const ROW_HEIGHT = 200;

/** Photos uploaded before dimensions were captured fall back to 3:2. */
const FALLBACK_ASPECT = 1.5;

function aspectOf(photo: GalleryPhoto): number {
  if (!photo.width || !photo.height) return FALLBACK_ASPECT;
  return photo.width / photo.height;
}

export function GalleryView({
  token,
  title,
  eventDate,
  photos,
  viewers,
  allowDownload,
  allowReactions,
}: {
  token: string;
  title: string;
  eventDate: string | null;
  photos: GalleryPhoto[];
  viewers: GalleryViewer[];
  allowDownload: boolean;
  allowReactions: boolean;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Map<string, number>>(
    () => new Map(photos.map((p) => [p.id, p.favoriteCount])),
  );
  const [namePromptFor, setNamePromptFor] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Map<string, PhotoReactionState>>(() => new Map());
  // Which reaction the name prompt interrupted, so it can be sent afterwards.
  const [pendingReaction, setPendingReaction] = useState<ReactionKind | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  // Touch devices have no hover, so selection mode is entered by long-press —
  // the same gesture Google Photos uses. Once on, every checkbox is visible.
  const longPress = useRef<{ timer: number | null; fired: boolean }>({
    timer: null,
    fired: false,
  });
  const [zipState, setZipState] = useState<"idle" | "preparing" | "error">("idle");

  const optedOut = useSyncExternalStore(
    subscribeOptOut,
    getOptOutSnapshot,
    getOptOutServerSnapshot,
  );
  const reportedPhotos = useRef(new Set<string>());

  const report = useCallback(
    (type: "GALLERY_VIEW" | "PHOTO_VIEW", photoId?: string) => {
      const anonKey = getViewerId();
      if (!anonKey) return;

      const payload = JSON.stringify({ anonKey, type, photoId });
      const url = `/api/g/${encodeURIComponent(token)}/activity`;

      // sendBeacon survives navigation away; fetch is the fallback.
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    },
    [token],
  );

  useEffect(() => {
    if (optedOut) return;
    report("GALLERY_VIEW");

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") report("GALLERY_VIEW");
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [optedOut, report]);

  // Hearts are per-viewer, and the viewer is only identified client-side, so
  // this can't be server-rendered.
  useEffect(() => {
    if (!allowReactions) return;
    const anonKey = getViewerId();
    if (!anonKey) return;

    const controller = new AbortController();
    void fetch(
      `/api/g/${encodeURIComponent(token)}/favorite?anonKey=${encodeURIComponent(anonKey)}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : { photoIds: [] }))
      .then((data: { photoIds: string[] }) => setFavorites(new Set(data.photoIds)))
      .catch(() => undefined);

    return () => controller.abort();
  }, [allowReactions, token]);

  // Reaction tallies are public, but "mine" is per-viewer, so this is fetched
  // client-side for the same reason the hearts are.
  useEffect(() => {
    if (!allowReactions) return;
    const anonKey = getViewerId();
    const query = anonKey ? `?anonKey=${encodeURIComponent(anonKey)}` : "";

    const controller = new AbortController();
    void fetch(`/api/g/${encodeURIComponent(token)}/reaction${query}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { reactions: {} }))
      .then((data: { reactions: Record<string, PhotoReactionState> }) =>
        setReactions(new Map(Object.entries(data.reactions))),
      )
      .catch(() => undefined);

    return () => controller.abort();
  }, [allowReactions, token]);

  const sendReaction = useCallback(
    async (photoId: string, kind: ReactionKind, displayName?: string) => {
      const anonKey = getViewerId();
      if (!anonKey) return;

      const response = await fetch(`/api/g/${encodeURIComponent(token)}/reaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonKey, photoId, kind, displayName }),
      });
      if (!response.ok) return;

      // The server is authoritative about the tally: two viewers reacting at
      // once would otherwise leave each of them with their own stale count.
      const data = (await response.json()) as {
        mine: ReactionKind | null;
        counts: Partial<Record<ReactionKind, number>>;
      };
      setReactions((prev) => new Map(prev).set(photoId, { counts: data.counts, mine: data.mine }));
    },
    [token],
  );

  const toggleReaction = useCallback(
    (photoId: string, kind: ReactionKind) => {
      const current = reactions.get(photoId)?.mine ?? null;
      const next = current === kind ? null : kind;

      // Optimistic: the picker responds to the tap, the counts follow.
      setReactions((prev) => {
        const entry = prev.get(photoId) ?? { counts: {}, mine: null };
        return new Map(prev).set(photoId, { ...entry, mine: next });
      });

      // Same "join" moment as the heart — asked once, always skippable.
      if (next && !getViewerName() && !hasAnsweredNamePrompt()) {
        setNamePromptFor(photoId);
        setPendingReaction(kind);
        return;
      }

      void sendReaction(photoId, kind, getViewerName() ?? undefined);
    },
    [reactions, sendReaction],
  );

  const sendFavorite = useCallback(
    async (photoId: string, favorite: boolean, displayName?: string) => {
      const anonKey = getViewerId();
      if (!anonKey) return;

      const response = await fetch(`/api/g/${encodeURIComponent(token)}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonKey, photoId, favorite, displayName }),
      });
      if (!response.ok) return;

      const data = (await response.json()) as { count: number };
      setCounts((prev) => new Map(prev).set(photoId, data.count));
    },
    [token],
  );

  const toggleFavorite = useCallback(
    (photoId: string) => {
      const next = !favorites.has(photoId);

      // Optimistic: the heart flips immediately, the count follows the server.
      setFavorites((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(photoId);
        else copy.delete(photoId);
        return copy;
      });

      // Google Photos asks who you are the moment you first interact — the
      // "join" moment. We do the same, and it stays optional.
      if (next && !getViewerName() && !hasAnsweredNamePrompt()) {
        setNamePromptFor(photoId);
        return;
      }

      void sendFavorite(photoId, next, getViewerName() ?? undefined);
    },
    [favorites, sendFavorite],
  );

  const photoIds = useMemo(() => photos.map((photo) => photo.id), [photos]);
  const selectionActive = allowDownload && selection.ids.size > 0;

  const cancelLongPress = useCallback(() => {
    if (longPress.current.timer !== null) {
      clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
    }
  }, []);

  const pick = useCallback(
    (index: number, id: string, shiftKey: boolean) => {
      setSelection((prev) =>
        shiftKey ? selectRange(prev, index, (i) => photoIds[i]) : toggleOne(prev, index, id),
      );
    },
    [photoIds],
  );

  /**
   * Asks the server for a signed manifest, then hands it to the ZIP worker.
   *
   * An empty selection means the whole gallery — the same request either way,
   * so "Stáhnout vše" and "Stáhnout vybrané" cannot drift apart.
   */
  const downloadZip = useCallback(
    async (ids: string[]) => {
      setZipState("preparing");
      try {
        const response = await fetch(`/api/g/${encodeURIComponent(token)}/zip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: ids }),
        });
        if (!response.ok) {
          setZipState("error");
          return;
        }

        const { url, manifest } = (await response.json()) as { url: string; manifest: string };

        // A form POST rather than fetch(): the response is gigabytes and must
        // stream straight to disk, never through the page's memory.
        const form = document.createElement("form");
        form.method = "POST";
        form.action = url;
        form.style.display = "none";
        const field = document.createElement("input");
        field.type = "hidden";
        field.name = "manifest";
        field.value = manifest;
        form.append(field);
        document.body.append(form);
        form.submit();
        form.remove();

        setZipState("idle");
      } catch {
        setZipState("error");
      }
    },
    [token],
  );

  const openPhoto = useCallback(
    (index: number) => {
      setLightboxIndex(index);
      const photo = photos[index];
      // A "photo view" is a lightbox open, not a thumbnail impression —
      // srcset prefetches would otherwise inflate the numbers.
      if (photo && !reportedPhotos.current.has(photo.id)) {
        reportedPhotos.current.add(photo.id);
        report("PHOTO_VIEW", photo.id);
      }
    },
    [photos, report],
  );

  const move = useCallback(
    (delta: number) => {
      setLightboxIndex((current) => {
        if (current === null) return current;
        const next = (current + delta + photos.length) % photos.length;
        const photo = photos[next];
        if (photo && !reportedPhotos.current.has(photo.id)) {
          reportedPhotos.current.add(photo.id);
          report("PHOTO_VIEW", photo.id);
        }
        return next;
      });
    },
    [photos, report],
  );

  useEffect(() => {
    if (lightboxIndex === null) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxIndex(null);
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);

      // Space and S both toggle. Space is the reflex; S is there because Space
      // is also "scroll" muscle memory and some keyboards make it awkward.
      if (allowDownload && (event.key === " " || event.key.toLowerCase() === "s")) {
        // Space would otherwise scroll the grid behind the dialog.
        event.preventDefault();
        const index = lightboxIndex;
        const photo = index === null ? undefined : photos[index];
        if (index !== null && photo) pick(index, photo.id, false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowDownload, lightboxIndex, move, photos, pick]);

  const active = lightboxIndex === null ? null : photos[lightboxIndex];
  const activeSelected = active ? selection.ids.has(active.id) : false;

  /**
   * Warms the next and previous photo while the current one is on screen.
   *
   * Without this every swipe is a cold fetch of 120 kB on a phone and up to
   * 600 kB on a retina desktop, so the screen goes blank for as long as that
   * takes — 500 times if the viewer works through the gallery.
   *
   * A <link rel="preload"> with imagesrcset/imagesizes rather than a computed
   * URL: the browser then applies the same candidate-selection it will apply to
   * the real <img>, so the byte range fetched is exactly the one that gets used.
   * Guessing the width would risk warming a variant the browser ignores — the
   * swipe would still stall AND the transformation would be billed twice.
   */
  useEffect(() => {
    if (lightboxIndex === null || photos.length < 2) return;

    const neighbours = [
      photos[(lightboxIndex + 1) % photos.length],
      photos[(lightboxIndex - 1 + photos.length) % photos.length],
    ];

    const links = neighbours
      .filter((photo): photo is GalleryPhoto => photo !== undefined && photo.id !== active?.id)
      .map((photo) => {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.imageSrcset = fullWidthSrcSet(photo.objectKey, imageLoader);
        link.imageSizes = "100vw";
        // Deliberately NO crossOrigin. next/image renders a plain <img> with no
        // crossorigin attribute, and a preload whose CORS mode differs from the
        // eventual request is a cache MISS — the browser would fetch the photo
        // twice, making the swipe no faster and doubling the billed transforms.
        // Verified in a real browser: with crossOrigin="anonymous" set, the
        // preload and the <img> disagreed.
        //
        // Chrome logs "preloaded but not used within a few seconds" when the
        // viewer lingers on a photo. That is inherent to speculative prefetch
        // and not a bug — the warning is the cost of the swipe being instant
        // when they do move.
        document.head.append(link);
        return link;
      });

    return () => {
      for (const link of links) link.remove();
    };
  }, [active?.id, lightboxIndex, photos]);

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {eventDate && <p className="text-sm text-neutral-500">{eventDate}</p>}
        </div>
        <div className="flex items-center gap-3">
          <PresenceStrip token={token} optedOut={optedOut} />
          {viewers.length > 0 && <ViewerChips viewers={viewers} />}
        </div>
      </header>

      {allowDownload && photos.length > 0 && (
        <div className="sticky top-0 z-30 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b bg-white/90 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 dark:bg-neutral-950/90">
          {selection.ids.size > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setSelection(clearSelection())}
                aria-label="Zrušit výběr"
                className="rounded-full border px-2 py-1 text-sm"
              >
                ✕
              </button>
              <span className="text-sm font-medium">
                {pluralize(selection.ids.size, FORMS.selected)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelection((prev) =>
                    isAllSelected(prev, photoIds) ? clearSelection() : selectAll(photoIds),
                  )
                }
                className="text-sm underline"
              >
                {isAllSelected(selection, photoIds) ? "Odznačit vše" : "Vybrat vše"}
              </button>
              <button
                type="button"
                disabled={zipState === "preparing"}
                onClick={() => void downloadZip(selectedInOrder(selection, photoIds))}
                className="ml-auto rounded-full bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {zipState === "preparing"
                  ? "Připravuji…"
                  : `Stáhnout ${pluralize(selection.ids.size, FORMS.photoAccusative)}${
                      selection.ids.size > 1 ? " (ZIP)" : ""
                    }`}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-neutral-500">
                Podrž fotku (nebo na ni najeď myší) a vyber, co chceš stáhnout.
              </span>
              <button
                type="button"
                disabled={zipState === "preparing"}
                onClick={() => void downloadZip([])}
                className="ml-auto rounded-full bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {zipState === "preparing"
                  ? "Připravuji…"
                  : photos.length > 1
                    ? "Stáhnout vše (ZIP)"
                    : "Stáhnout fotku"}
              </button>
            </>
          )}
          {zipState === "error" && (
            <span className="w-full text-xs text-red-600">
              Stažení se nepodařilo připravit. Zkus to prosím znovu.
            </span>
          )}
        </div>
      )}

      {/* Justified rows: each tile grows in proportion to its aspect ratio, so
          a row fills the width exactly at a near-constant height. The zero-height
          spacers stop the final row from stretching its few photos. */}
      <ul className="flex flex-wrap gap-2">
        {photos.map((photo, index) => {
          const aspect = aspectOf(photo);
          return (
            <li
              key={photo.id}
              className="group relative h-36 select-none sm:h-48 lg:h-52"
              style={{ flexGrow: aspect, flexBasis: `${aspect * ROW_HEIGHT}px` }}
              onTouchStart={() => {
                if (!allowDownload) return;
                longPress.current.fired = false;
                longPress.current.timer = window.setTimeout(() => {
                  longPress.current.fired = true;
                  setSelection((prev) => toggleOne(prev, index, photo.id));
                }, LONG_PRESS_MS);
              }}
              onTouchMove={() => cancelLongPress()}
              onTouchEnd={() => cancelLongPress()}
              onTouchCancel={() => cancelLongPress()}
              // A long press otherwise raises the browser's "save image" sheet
              // on top of the selection we just made.
              onContextMenu={(event) => {
                if (selectionActive) event.preventDefault();
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  // The long press already acted; the click it synthesises must
                  // not toggle the same photo straight back off.
                  if (longPress.current.fired) {
                    longPress.current.fired = false;
                    return;
                  }
                  // While a selection is active the tile extends it rather than
                  // opening the lightbox — otherwise picking 40 photos means 40
                  // precise taps on a small circle.
                  if (selectionActive) {
                    pick(index, photo.id, event.shiftKey);
                    return;
                  }
                  openPhoto(index);
                }}
                className="relative block h-full w-full overflow-hidden rounded"
                // The tile carries the photo's own average colour, so the grid
                // fills in with the picture's palette instead of grey holes.
                style={{ backgroundColor: placeholderStyle(photo.placeholder) }}
                aria-label={
                  selectionActive ? `Vybrat ${photo.fileName}` : `Otevřít ${photo.fileName}`
                }
              >
                <Image
                  src={photo.objectKey}
                  alt={photo.fileName}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  priority={index < EAGER_TILES}
                  className={`object-cover transition-transform duration-200 ${
                    selection.ids.has(photo.id) ? "scale-90 rounded" : "hover:scale-105"
                  }`}
                />
              </button>
              {allowDownload && (
                <SelectCheck
                  selected={selection.ids.has(photo.id)}
                  pinned={selectionActive}
                  onPick={(shiftKey) => pick(index, photo.id, shiftKey)}
                  fileName={photo.fileName}
                />
              )}
              {allowReactions && (
                <>
                  <HeartButton
                    active={favorites.has(photo.id)}
                    count={counts.get(photo.id) ?? 0}
                    onClick={() => toggleFavorite(photo.id)}
                    className="absolute right-2 bottom-2"
                  />
                  <ReactionBadge state={reactions.get(photo.id)} />
                </>
              )}
            </li>
          );
        })}
        {Array.from({ length: 6 }, (_, index) => (
          <li
            key={`spacer-${index}`}
            aria-hidden
            className="h-0"
            style={{ flexGrow: FALLBACK_ASPECT, flexBasis: `${FALLBACK_ASPECT * ROW_HEIGHT}px` }}
          />
        ))}
      </ul>

      {photos.length === 0 && (
        <p className="text-sm text-neutral-500">V galerii zatím nejsou žádné fotky.</p>
      )}

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.fileName}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="relative h-full w-full touch-pan-y"
            style={{ backgroundColor: "transparent" }}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              const touch = event.changedTouches[0];
              touchStart.current = null;
              if (!start || !touch) return;

              const dx = touch.clientX - start.x;
              // A mostly-vertical drag is a scroll attempt, not a swipe.
              if (Math.abs(touch.clientY - start.y) > SWIPE_MAX_VERTICAL_PX) return;
              if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
              move(dx < 0 ? 1 : -1);
            }}
          >
            <Image
              src={active.objectKey}
              alt={active.fileName}
              fill
              sizes="100vw"
              className={`object-contain transition-all duration-200 ${
                activeSelected ? "scale-[0.93]" : ""
              }`}
              priority
            />
            {activeSelected && (
              // Inset ring rather than a border on the image: the image is
              // object-contain, so a border would frame the letterboxing, not
              // the photo.
              <span
                aria-hidden
                className="pointer-events-none absolute inset-4 rounded-lg ring-4 ring-blue-500/80 ring-inset"
              />
            )}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
            className="absolute left-4 rounded-full bg-white/10 px-4 py-3 text-white"
            aria-label="Předchozí"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
            className="absolute right-4 rounded-full bg-white/10 px-4 py-3 text-white"
            aria-label="Další"
          >
            ›
          </button>
          <div
            className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxIndex(null)}
              className="rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20"
              aria-label="Zavřít"
            >
              ✕
            </button>

            {allowDownload && (
              <button
                type="button"
                onClick={() => pick(lightboxIndex!, active.id, false)}
                aria-pressed={activeSelected}
                className={`flex items-center gap-2 rounded-full py-2 pr-4 pl-2 text-sm transition ${
                  activeSelected
                    ? "bg-blue-600 text-white"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs ${
                    activeSelected ? "border-white bg-white text-blue-600" : "border-white/80"
                  }`}
                >
                  ✓
                </span>
                {activeSelected ? "Vybráno" : "Vybrat"}
              </button>
            )}

            <span className="ml-auto text-sm text-white/70 tabular-nums">
              {lightboxIndex! + 1} / {photos.length}
            </span>

            {allowDownload && selection.ids.size > 0 && (
              <>
                <span className="text-sm text-white/70">
                  {pluralize(selection.ids.size, FORMS.selected)}
                </span>
                <button
                  type="button"
                  disabled={zipState === "preparing"}
                  onClick={() => void downloadZip(selectedInOrder(selection, photoIds))}
                  className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
                >
                  {zipState === "preparing" ? "Připravuji…" : "Stáhnout"}
                </button>
              </>
            )}
          </div>

          <div
            className="absolute bottom-4 flex items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {allowReactions && (
              <>
                <HeartButton
                  active={favorites.has(active.id)}
                  count={counts.get(active.id) ?? 0}
                  onClick={() => toggleFavorite(active.id)}
                  className="bg-white/10 text-white"
                />
                <ReactionBar
                  state={reactions.get(active.id)}
                  onPick={(kind) => toggleReaction(active.id, kind)}
                />
              </>
            )}
            {allowDownload && (
              <button
                type="button"
                disabled={zipState === "preparing"}
                onClick={() => void downloadZip([active.id])}
                className="rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-50"
              >
                {zipState === "preparing" ? "Připravuji…" : "Stáhnout originál"}
              </button>
            )}
          </div>
        </div>
      )}

      {namePromptFor && (
        <NamePrompt
          onSubmit={(name) => {
            const photoId = namePromptFor;
            const kind = pendingReaction;
            setNamePromptFor(null);
            setPendingReaction(null);
            if (name) setViewerName(name);
            else dismissNamePrompt();

            // The prompt interrupts exactly one action; resume that one only.
            if (kind) void sendReaction(photoId, kind, name || undefined);
            else void sendFavorite(photoId, true, name || undefined);
          }}
        />
      )}

      <footer className="mt-10 space-y-4 border-t pt-4 text-xs text-neutral-500">
        {photos.length > 0 && (
          <div className="rounded-lg border p-4">
            <p className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Offline přístup
            </p>
            <OfflineToggle token={token} objectKeys={photos.map((photo) => photo.objectKey)} />
          </div>
        )}
        <p>
          Počítáme návštěvy galerie pomocí identifikátoru uloženého jen ve tvém prohlížeči — slouží
          k tvým oblíbeným fotkám a k tomu, aby se jedna návštěva nezapočítala vícekrát. Nepředáváme
          ho nikam dál a neukládáme IP adresu.
        </p>
        {!optedOut ? (
          <button type="button" className="mt-2 underline" onClick={optOut}>
            Nepočítat mě
          </button>
        ) : (
          <p className="mt-2">Tvoje návštěvy se nepočítají.</p>
        )}
      </footer>
    </main>
  );
}

function HeartButton({
  active,
  count,
  onClick,
  className = "",
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
      className={`flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm ${className}`}
    >
      <span aria-hidden>{active ? "♥" : "♡"}</span>
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * The circular checkbox, top-left, as in Google Photos.
 *
 * Hidden until hover on pointer devices — 500 permanent circles would shout
 * over the photos. Tailwind 4 gates `hover:` behind `(hover: hover)`, so on a
 * phone the hover rule never fires and the checkbox appears only once
 * selection mode has been entered by long press.
 */
function SelectCheck({
  selected,
  pinned,
  onPick,
  fileName,
}: {
  selected: boolean;
  /** Selection mode is on, so every checkbox stays visible. */
  pinned: boolean;
  onPick: (shiftKey: boolean) => void;
  fileName: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Vybrat ${fileName}`}
      // Stops the tile's own handler from also firing and opening the lightbox.
      onClick={(event) => {
        event.stopPropagation();
        onPick(event.shiftKey);
      }}
      className={`absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs transition-opacity ${
        selected
          ? "border-white bg-blue-600 text-white opacity-100"
          : `border-white/80 bg-black/25 text-transparent hover:bg-black/45 ${
              pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`
      }`}
    >
      ✓
    </button>
  );
}

/**
 * The picker. Rendered in the lightbox only: on a grid tile it would compete
 * with the heart for the same corner and turn a scroll into a mis-tap.
 */
function ReactionBar({
  state,
  onPick,
}: {
  state: PhotoReactionState | undefined;
  onPick: (kind: ReactionKind) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 backdrop-blur-sm">
      {REACTION_KINDS.map((kind) => {
        const count = state?.counts[kind] ?? 0;
        const mine = state?.mine === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            aria-pressed={mine}
            aria-label={REACTION_LABEL[kind]}
            title={REACTION_LABEL[kind]}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-sm transition-transform ${
              mine ? "scale-110 bg-white/25" : "hover:bg-white/15"
            }`}
          >
            <span aria-hidden>{REACTION_EMOJI[kind]}</span>
            {count > 0 && <span className="text-xs text-white tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact summary on a grid tile — the picker itself lives in the lightbox. */
function ReactionBadge({ state }: { state: PhotoReactionState | undefined }) {
  const total = totalReactions(state);
  if (total === 0) return null;

  // At most three distinct emoji, so a busy photo does not overflow the tile.
  const kinds = REACTION_KINDS.filter((kind) => (state?.counts[kind] ?? 0) > 0).slice(0, 3);

  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white backdrop-blur-sm">
      <span aria-hidden>{kinds.map((kind) => REACTION_EMOJI[kind]).join("")}</span>
      <span className="tabular-nums">{total}</span>
    </span>
  );
}

function ViewerChips({ viewers }: { viewers: GalleryViewer[] }) {
  return (
    <div className="flex items-center -space-x-2" aria-label="Kdo si galerii prohlédl">
      {viewers.map((viewer) => (
        <span
          key={viewer.id}
          title={viewer.displayName}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-neutral-200 text-xs font-medium dark:border-neutral-900 dark:bg-neutral-700"
        >
          {viewer.displayName.slice(0, 2).toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
      <form
        className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 dark:bg-neutral-900"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value.trim());
        }}
      >
        <h2 className="text-lg font-semibold">Kdo se dívá?</h2>
        <p className="text-sm text-neutral-500">
          Jméno uvidí ostatní u tvých oblíbených fotek. Můžeš ho i přeskočit.
        </p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={60}
          autoFocus
          placeholder="Např. Petra"
          className="w-full rounded border px-3 py-2"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => onSubmit("")}
          >
            Přeskočit
          </button>
          <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            Uložit
          </button>
        </div>
      </form>
    </div>
  );
}
