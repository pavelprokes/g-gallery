"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
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
import imageLoader from "@/lib/image-loader";
import { fullWidthSrcSet } from "@/lib/image-sizes";
import { placeholderStyle } from "@/lib/placeholder";
import { justifyRows, type JustifiedRow } from "@/lib/justified-layout";
import {
  clampPan,
  clampScale,
  distance,
  DOUBLE_TAP_SCALE,
  isZoomed,
  midpoint,
  type Point,
  zoomAround,
} from "@/lib/zoom-pan";
import { srcFor } from "@/lib/image-src";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Slideshow } from "@/components/slideshow";
import { GuestUploader } from "@/components/guest-uploader";
import { OfflineIconButton } from "@/components/offline-toggle";
import { Button } from "@/components/ui/button";
import { IconButton, IconButtonLink, NavButton } from "@/components/ui/icon-button";
import {
  CheckCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  ProjectorIcon,
} from "@/components/ui/icons";
import type { SignedImageGrant } from "@/lib/image-signing";
import {
  REACTION_EMOJI,
  REACTION_KINDS,
  totalReactions,
  useReactionLabels,
  type PhotoReactionState,
  type ReactionKind,
} from "@/lib/reactions-shared";
import { MAX_PRINT_QUANTITY, clampPrintQuantity } from "@/lib/print-selections-shared";

/** Distance a touch must travel before it counts as a swipe, not a tap. */
const SWIPE_THRESHOLD_PX = 50;

/** Beyond this the gesture is a scroll, not a horizontal swipe. */
const SWIPE_MAX_VERTICAL_PX = 80;

/** Long press to enter selection mode on touch. Matches the platform feel. */
const LONG_PRESS_MS = 450;

export interface GalleryPhoto {
  id: string;
  objectKey: string;
  /** Browser-made 512 px WebP, when the uploading device could produce one. */
  thumbObjectKey: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
  favoriteCount: number;
}

export interface GalleryViewer {
  id: string;
  displayName: string;
}

/** Heartbeat cadence while the tab is visible; also keeps Supabase awake. */
const HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Target row height a justified row aims for before being scaled to fill the
 * container width exactly (src/lib/justified-layout.ts) — scaled down on a
 * narrow container so a two-column phone grid gets Google-Photos-sized
 * tiles instead of the desktop target stretched over a much smaller width,
 * which would need every tile far taller than the phone's own screen is wide.
 */
function targetRowHeight(containerWidth: number): number {
  if (containerWidth < 500) return 120;
  if (containerWidth < 900) return 160;
  return 220;
}

/**
 * On a phone, a fixed 2-column grid (Google/Apple Photos' own pattern) reads
 * calmer than an adaptive row that lands on 3+ narrow tiles depending on
 * each photo's aspect ratio. Wider containers keep the adaptive row count —
 * more columns there is the point, not a bug.
 */
function itemsPerRow(containerWidth: number): number | undefined {
  return containerWidth < 640 ? 2 : undefined;
}

/** Gap between tiles, both within a row and between rows — the layout
 * algorithm and the row's own flex gap must agree, or rows would overlap
 * or leave a seam. Tight on purpose: the photos, not the grid, are the
 * thing being looked at. */
const GAP = 4;

/**
 * Horizontal gutter for the page's text chrome — header, selection toolbar,
 * footer. The grid gets no gutter of its own: it runs edge to edge on a
 * phone and keeps only the container's 4 px above `sm`, so text would
 * otherwise sit against the screen edge. `sm:px-3` lands on the same 16 px
 * as the phone once the container's own 4 px is added.
 */
const GUTTER = "px-4 sm:px-3";

/** Photos uploaded before dimensions were captured fall back to 3:2. */
const FALLBACK_ASPECT = 1.5;

function aspectOf(photo: GalleryPhoto): number {
  if (!photo.width || !photo.height) return FALLBACK_ASPECT;
  return photo.width / photo.height;
}

/** Appends the signed access grant (docs/PLAN.md §4.1) to an object key, if
 * one was minted — the loader parses it back off (src/lib/image-loader.ts).
 * Without a grant this is the object key untouched, today's behaviour. */
/**
 * Traps Tab/Shift+Tab inside a modal container and restores focus to
 * whatever was focused before it opened. Shared by the lightbox and the name
 * prompt, which can each appear stacked over the grid.
 */
function useFocusTrap<T extends HTMLElement>(containerRef: RefObject<T | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const restoreTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    (getFocusable()[0] ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = getFocusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      restoreTarget?.focus();
    };
  }, [active, containerRef]);
}

/** Movement under this is still a tap, not a drag — fingers are never still. */
const TAP_SLOP_PX = 8;

/** Two taps inside this window are a double tap. Also how long a single tap
 * waits before acting, since it cannot know yet that it is single. */
const DOUBLE_TAP_MS = 260;

/** Two taps further apart than this are two separate taps, not a double tap —
 * a thumb lands in a slightly different place each time. */
const DOUBLE_TAP_SLOP_PX = 40;

/** How far a downward drag must travel before letting go closes the photo. */
const DISMISS_THRESHOLD_PX = 110;

/** Drag-to-dismiss fades as it goes; this is the travel that reaches
 * transparent, so the gesture reads as "throwing the photo away". */
const DISMISS_FADE_PX = 400;

interface LightboxGestures {
  /** Puts the photo back to fitted; called when the photo itself changes. */
  reset: () => void;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * Every gesture the open photo answers to, in one place: pinch and double-tap
 * to zoom, drag to pan while zoomed, swipe sideways for the next photo, swipe
 * down to close, and a plain tap to get the chrome out of the way.
 *
 * They share a handler because they are told apart by the same few numbers —
 * how many fingers, how far, which way, how long. Pointer events rather than
 * touch events, so a mouse gets the same behaviour for free, with
 * `touch-action: none` on the surface so the browser's own pan and zoom don't
 * race this one.
 *
 * The transform is written straight to `frameRef.current.style` instead of
 * through state: a pinch produces pointer events far faster than React can
 * re-render, and a photo that lags the fingers by a frame feels broken.
 * Changing photo calls `reset` rather than remounting the component — see
 * `LightboxPhoto`, where the remount was itself a source of flicker.
 */
function useLightboxGestures(
  frameRef: RefObject<HTMLElement | null>,
  aspect: number,
  onSwipe: (delta: 1 | -1) => void,
  onDismiss: () => void,
  onTap: () => void,
  onZoomChange: (zoomed: boolean) => void,
): LightboxGestures {
  const scale = useRef(1);
  const pan = useRef<Point>({ x: 0, y: 0 });
  const rect = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    kind: "drag" | "pan" | "pinch";
    startPan: Point;
    startScale: number;
    startPoint: Point;
    startDistance: number;
    focus: Point;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const tapTimer = useRef<number | null>(null);

  const paint = useCallback(
    (nextScale: number, nextPan: Point, dismiss: number, animated: boolean) => {
      const wasZoomed = isZoomed(scale.current);
      scale.current = nextScale;
      pan.current = nextPan;

      const frame = frameRef.current;
      if (frame) {
        frame.style.transition = animated ? "transform 200ms, opacity 200ms" : "none";
        frame.style.transform = `translate3d(${nextPan.x}px, ${
          nextPan.y + dismiss
        }px, 0) scale(${nextScale})`;
        // A drag-to-dismiss fades as it travels, so letting go halfway reads
        // as a decision rather than an accident.
        frame.style.opacity = String(Math.max(0.2, 1 - dismiss / DISMISS_FADE_PX));
      }

      if (isZoomed(nextScale) !== wasZoomed) onZoomChange(isZoomed(nextScale));
    },
    [frameRef, onZoomChange],
  );

  const cancelTapTimer = useCallback(() => {
    if (tapTimer.current === null) return;
    clearTimeout(tapTimer.current);
    tapTimer.current = null;
  }, []);

  useEffect(() => cancelTapTimer, [cancelTapTimer]);

  /** Client coordinates as an offset from the frame's centre, which is where
   * the CSS transform is anchored. */
  const toCentre = useCallback(
    (point: Point): Point => ({
      x: point.x - (rect.current.left + rect.current.width / 2),
      y: point.y - (rect.current.top + rect.current.height / 2),
    }),
    [],
  );

  const size = useCallback(() => ({ width: rect.current.width, height: rect.current.height }), []);

  const toggleZoom = useCallback(
    (focus: Point) => {
      if (isZoomed(scale.current)) {
        paint(1, { x: 0, y: 0 }, 0, true);
        return;
      }
      const next = DOUBLE_TAP_SCALE;
      paint(
        next,
        clampPan(zoomAround(focus, { x: 0, y: 0 }, 1, next), size(), aspect, next),
        0,
        true,
      );
    },
    [aspect, paint, size],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Measured per gesture rather than cached: the frame is the viewport here,
    // and the viewport changes when a phone's browser bar slides away.
    const box = event.currentTarget.getBoundingClientRect();
    rect.current = { left: box.left, top: box.top, width: box.width, height: box.height };
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);

    const active = [...pointers.current.values()];
    const [first, second] = active;
    if (active.length >= 2 && first && second) {
      const between = midpoint(first, second);
      gesture.current = {
        kind: "pinch",
        startPan: pan.current,
        startScale: scale.current,
        startPoint: point,
        startDistance: distance(first, second),
        focus: {
          x: between.x - (box.left + box.width / 2),
          y: between.y - (box.top + box.height / 2),
        },
        moved: true,
      };
      return;
    }

    gesture.current = {
      kind: isZoomed(scale.current) ? "pan" : "drag",
      startPan: pan.current,
      startScale: scale.current,
      startPoint: point,
      startDistance: 0,
      focus: { x: 0, y: 0 },
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!pointers.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, point);

      const current = gesture.current;
      if (!current) return;

      if (current.kind === "pinch") {
        const [first, second] = [...pointers.current.values()];
        if (!first || !second || current.startDistance <= 0) return;
        const next = clampScale(
          current.startScale * (distance(first, second) / current.startDistance),
        );
        paint(
          next,
          clampPan(
            zoomAround(current.focus, current.startPan, current.startScale, next),
            size(),
            aspect,
            next,
          ),
          0,
          false,
        );
        return;
      }

      const dx = point.x - current.startPoint.x;
      const dy = point.y - current.startPoint.y;
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) current.moved = true;

      if (current.kind === "pan") {
        paint(
          current.startScale,
          clampPan(
            { x: current.startPan.x + dx, y: current.startPan.y + dy },
            size(),
            aspect,
            current.startScale,
          ),
          0,
          false,
        );
        return;
      }

      // Only a downward, mostly-vertical drag is a dismissal; a sideways one is
      // on its way to being the next photo and must not drag anything.
      const dismissing = dy > 0 && Math.abs(dy) > Math.abs(dx);
      paint(current.startScale, current.startPan, dismissing ? dy : 0, false);
    },
    [aspect, paint, size],
  );

  const endGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const known = pointers.current.delete(event.pointerId);
      const current = gesture.current;
      if (!known || !current) return;

      if (current.kind === "pinch") {
        // Down to one finger: re-anchor on it so it pans from where the photo
        // actually is, rather than scaling against a distance that no longer
        // has two pointers behind it.
        const remaining = [...pointers.current.values()][0];
        gesture.current = remaining
          ? {
              kind: "pan",
              startPan: pan.current,
              startScale: scale.current,
              startPoint: remaining,
              startDistance: 0,
              focus: { x: 0, y: 0 },
              moved: true,
            }
          : null;
        // A pinch that ends barely zoomed means "back to the whole photo".
        if (!remaining && !isZoomed(scale.current)) paint(1, { x: 0, y: 0 }, 0, true);
        return;
      }

      gesture.current = null;

      // A pan that went anywhere is simply finished. One that didn't is a tap
      // on a zoomed-in photo, and still has to reach the tap handling below —
      // otherwise a photo, once zoomed, could never be zoomed back out.
      if (current.kind === "pan" && current.moved) return;

      // Whatever a drag did to the transform, put it back; only the decision
      // below depends on how far it travelled.
      if (current.kind === "drag") paint(current.startScale, current.startPan, 0, true);
      if (cancelled) return;

      const point = { x: event.clientX, y: event.clientY };
      const dx = point.x - current.startPoint.x;
      const dy = point.y - current.startPoint.y;

      if (current.kind === "drag") {
        if (dy > DISMISS_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
          onDismiss();
          return;
        }
        if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dy) <= SWIPE_MAX_VERTICAL_PX) {
          onSwipe(dx < 0 ? 1 : -1);
          return;
        }
      }
      if (current.moved) return;

      // A tap. It cannot yet know whether it is the first of two, so the
      // single-tap action waits out the double-tap window.
      const now = performance.now();
      const previous = lastTap.current;
      cancelTapTimer();
      if (
        previous &&
        now - previous.at < DOUBLE_TAP_MS &&
        distance(point, previous.point) < DOUBLE_TAP_SLOP_PX
      ) {
        lastTap.current = null;
        toggleZoom(toCentre(point));
        return;
      }

      lastTap.current = { at: now, point };
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null;
        onTap();
      }, DOUBLE_TAP_MS);
    },
    [cancelTapTimer, onDismiss, onSwipe, onTap, paint, toCentre, toggleZoom],
  );

  /**
   * Back to the fitted photo, without going through `paint`: this runs when
   * the photo changes, and the parent has already put its own zoom flag back.
   * Writing the DOM and the refs directly keeps it out of React's hands
   * entirely, which is what lets the images survive a photo change instead of
   * being remounted.
   */
  const reset = useCallback(() => {
    scale.current = 1;
    pan.current = { x: 0, y: 0 };
    gesture.current = null;
    lastTap.current = null;
    pointers.current.clear();
    cancelTapTimer();

    const frame = frameRef.current;
    if (!frame) return;
    frame.style.transition = "none";
    frame.style.transform = "";
    frame.style.opacity = "";
  }, [cancelTapTimer, frameRef]);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => endGesture(event, false),
    [endGesture],
  );
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => endGesture(event, true),
    [endGesture],
  );

  return { reset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}

interface LightboxPhotoProps {
  photo: GalleryPhoto;
  src: string;
  /** The grid thumbnail to hold the frame until the full size arrives. */
  preview: { src: string; sizes: string } | null;
  loaded: boolean;
  selected: boolean;
  onLoad: () => void;
  onSwipe: (delta: 1 | -1) => void;
  onDismiss: () => void;
  onTap: () => void;
  onZoomChange: (zoomed: boolean) => void;
}

/**
 * The photo itself inside the lightbox, and every gesture aimed at it.
 *
 * Deliberately *not* keyed by photo id in the parent, and deliberately never
 * hiding the full-size image while it loads. Both are flicker: a remount
 * throws the `<img>` away, so the next photo has nothing to show until its
 * own first paint, and an image held at `opacity-0` until `onLoad` is a black
 * screen for exactly as long as the decode takes. Reusing the element means
 * the browser holds the previous photo's pixels until the next one is ready
 * to replace them — which is what every native photo viewer does, and the
 * only way through a swipe without a gap.
 */
function LightboxPhoto({
  photo,
  src,
  preview,
  loaded,
  selected,
  onLoad,
  onSwipe,
  onDismiss,
  onTap,
  onZoomChange,
}: LightboxPhotoProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { reset, handlers } = useLightboxGestures(
    frameRef,
    aspectOf(photo),
    onSwipe,
    onDismiss,
    onTap,
    onZoomChange,
  );

  // The zoom belongs to the photo that was zoomed, so it goes back to fitted
  // when a different one arrives. `move` and `openPhoto` in the parent have
  // already put the zoom flag back; this is the transform itself.
  useEffect(() => {
    reset();
  }, [photo.id, reset]);

  // The held-frame swap above stays silent on purpose — a spinner on every
  // swipe would fight the "no flicker" design. But past ~1.2s the still-shown
  // photo stops reading as "instant" and starts reading as "stuck", so a
  // slow-only indicator earns its place: it never appears on a normal
  // connection, only once a fetch is actually running long. Keyed by photo id
  // rather than a plain boolean so the flag clears on its own once a new
  // photo arrives, with no synchronous reset inside the effect.
  const [staleFor, setStaleFor] = useState<string | null>(null);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setStaleFor(photo.id), 1200);
    return () => clearTimeout(timer);
  }, [photo.id, loaded]);
  const showStale = staleFor === photo.id && !loaded;

  return (
    <div
      // `touch-none` hands every gesture in here to the handlers above: the
      // browser's own pan and zoom would otherwise fight them for the same
      // fingers.
      className="relative h-full w-full touch-none bg-black select-none"
      onClick={(event) => event.stopPropagation()}
      {...handlers}
    >
      <div ref={frameRef} className="absolute inset-0">
        {/* The thumbnail the viewer just tapped, at the exact size the grid
            rendered it — already in the browser's cache, so it paints
            immediately and the full-size photo resolves on top of it. It only
            shows through on the very first open, when the image above it has
            no pixels yet; from then on that one holds the previous photo. It
            is unmounted only once the full size is opaque over it, never
            while anything is still fading. */}
        {preview && !loaded && (
          <Image
            alt=""
            src={preview.src}
            fill
            sizes={preview.sizes}
            // `fill` images lazy-load by default; this one exists precisely to
            // be on screen in the frame the lightbox opens in.
            loading="eager"
            className={`object-contain ${selected ? "scale-[0.93]" : ""}`}
          />
        )}
        <Image
          // The dialog itself is labelled with the photo's position; repeating
          // a file name here would only make a screen reader say "DSC_1234.jpg".
          alt=""
          src={src}
          fill
          sizes="100vw"
          onLoad={onLoad}
          // No fade, and never hidden: an image that is transparent until it
          // loads guarantees a black gap, and one that fades in over 200 ms
          // guarantees a visible one. An `<img>` shows nothing until it has
          // pixels and keeps its old ones until the new arrive, which is the
          // behaviour wanted here — the thumbnail below covers the first case
          // and the previous photo covers every case after it.
          className={`object-contain transition-transform duration-200 ${
            selected ? "scale-[0.93]" : ""
          }`}
          priority
        />
      </div>
      {showStale && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-4 bottom-4 flex size-8 items-center justify-center rounded-full bg-black/60"
        >
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </span>
      )}
      {selected && (
        // Inset ring rather than a border on the image: the image is
        // object-contain, so a border would frame the letterboxing, not the
        // photo.
        <span
          aria-hidden
          className="ring-brand-border/80 pointer-events-none absolute inset-4 ring-4 ring-inset"
        />
      )}
    </div>
  );
}

interface PhotosPage {
  items: GalleryPhoto[];
  nextCursor: string | null;
}

async function fetchPhotosPage(
  token: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<PhotosPage> {
  const url = `/api/g/${encodeURIComponent(token)}/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`failed to fetch photos page (${response.status})`);
  return (await response.json()) as PhotosPage;
}

/** Ids of the photos this viewer uploaded. Empty on any failure: the delete
 * affordance is a convenience, and a network blip must not look like an error
 * in a gallery someone is just browsing. */
async function fetchMyPhotoIds(
  token: string,
  anonKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return fetch(`/api/g/${encodeURIComponent(token)}/mine?anonKey=${encodeURIComponent(anonKey)}`, {
    signal,
  })
    .then((response) => (response.ok ? response.json() : { photoIds: [] }))
    .then((data: { photoIds: string[] }) => data.photoIds)
    .catch(() => []);
}

/** One `QueryClient` per gallery view, created once — this is the only
 * surface in the app using TanStack Query, so there is no reason for a
 * layout-level provider every other route would carry for nothing. */
export function GalleryView(props: GalleryViewProps) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <GalleryViewInner {...props} />
    </QueryClientProvider>
  );
}

interface GalleryViewProps {
  token: string;
  /** Only ever used to key the presence channel — never sent anywhere else. */
  galleryId: string;
  title: string;
  eventDate: string | null;
  /** Every confirmed photo in the gallery, not just the loaded pages — the
   * header says how big it is before the viewer has scrolled anywhere. */
  photoCount: number;
  initialPhotos: GalleryPhoto[];
  initialCursor: string | null;
  imageGrant: SignedImageGrant | null;
  viewers: GalleryViewer[];
  allowDownload: boolean;
  allowReactions: boolean;
  /** Share link lets whoever holds it add photos (docs/GUEST-GALLERIES.md §6). */
  allowUpload: boolean;
  /** Share link lets whoever holds it mark photos for print, with a quantity. */
  allowPrintSelection: boolean;
  /** Set only when this gallery was opened from a wedding page that lists more
   * than one — the way back to the rozcestník. Absent on a plain `/g/` link,
   * which must never reveal that a wedding page exists. */
  backHref?: string;
  backLabel?: string;
  /** Pre-built "download all" archive (docs/TODO.md §7), if one is ready — a
   * plain CDN link, not a Worker request. Null covers every other state
   * (never built, still building, or invalidated by a newer upload) equally;
   * the UI doesn't distinguish them, since there is nothing the viewer can
   * do about any of those besides wait. */
  archiveZipUrl: string | null;
}

function GalleryViewInner({
  token,
  galleryId,
  title,
  eventDate,
  photoCount,
  initialPhotos,
  initialCursor,
  imageGrant,
  viewers,
  allowDownload,
  allowReactions,
  allowUpload,
  allowPrintSelection,
  archiveZipUrl,
  backHref,
  backLabel,
}: GalleryViewProps) {
  const t = useTranslations("gallery");
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Which photo's full-res image has actually finished loading — drives the
  // lightbox fade-in below. Starts at null so even the very first photo
  // fades in rather than popping straight onto the black background.
  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Map<string, number>>(
    () => new Map(initialPhotos.map((p) => [p.id, p.favoriteCount])),
  );
  const [namePromptFor, setNamePromptFor] = useState<string | null>(null);
  const [projecting, setProjecting] = useState(false);
  // Photos this viewer uploaded — the only ones they may take back
  // (docs/GUEST-GALLERIES.md §7). Per-viewer, so like favourites it cannot be
  // server-rendered.
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [reactions, setReactions] = useState<Map<string, PhotoReactionState>>(() => new Map());
  // Which reaction the name prompt interrupted, so it can be sent afterwards.
  const [pendingReaction, setPendingReaction] = useState<ReactionKind | null>(null);
  // This viewer's own print quantities — per-viewer like favorites, so it
  // can't be server-rendered either.
  const [printSelections, setPrintSelections] = useState<Map<string, number>>(() => new Map());
  // The quantity the name prompt interrupted, so it can be sent afterwards.
  const [pendingPrint, setPendingPrint] = useState<number | null>(null);
  // Which way the viewer was last moving through the lightbox — the preload
  // effect uses this to warm a photo two steps ahead, not just one, so fast
  // repeated next/prev doesn't keep outrunning the network by exactly one.
  const lastDirection = useRef<1 | -1>(1);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [zipState, setZipState] = useState<"idle" | "preparing" | "error">("idle");
  // Reviewing your own picks before telling the photographer which to retouch
  // — the one view of the gallery that isn't "all of it, newest first".
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Chrome hides so the photo can be looked at, either because the viewer
  // tapped it away or because they zoomed in — the transform itself lives in
  // `LightboxPhoto`, which reports only this crossing back up.
  const [chromeHidden, setChromeHidden] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const optedOut = useSyncExternalStore(
    subscribeOptOut,
    getOptOutSnapshot,
    getOptOutServerSnapshot,
  );
  const reportedPhotos = useRef(new Set<string>());

  // Cursor-paginated timeline (docs/AUDIT.md §6/§7 reopening threshold —
  // this is that reopening). Seeded with the server-rendered first page so
  // there is no client fetch for the initial paint.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["gallery-photos", token],
    queryFn: ({ pageParam, signal }) => fetchPhotosPage(token, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: {
      pages: [{ items: initialPhotos, nextCursor: initialCursor }],
      pageParams: [null],
    },
  });

  /** Every photo fetched so far. The grid and the lightbox both work off
   * `photos` below, which is this list narrowed by the favourites filter;
   * anything that means "the gallery as a whole" wants this one. */
  const allPhotos = useMemo(() => data.pages.flatMap((page) => page.items), [data]);

  /**
   * What the grid and the lightbox actually show. The favourites filter can
   * only narrow what has been fetched, so while it is on the effect below
   * keeps pulling pages until the whole gallery is loaded — a hearted photo
   * can sit on any page, and a filter that silently omits some of them is
   * worse than no filter.
   */
  const photos = useMemo(
    () => (favoritesOnly ? allPhotos.filter((photo) => favorites.has(photo.id)) : allPhotos),
    [allPhotos, favoritesOnly, favorites],
  );

  useEffect(() => {
    if (!favoritesOnly || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [favoritesOnly, hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  // Print quantities are per-viewer, same reason as the hearts above.
  useEffect(() => {
    if (!allowPrintSelection) return;
    const anonKey = getViewerId();
    if (!anonKey) return;

    const controller = new AbortController();
    void fetch(`/api/g/${encodeURIComponent(token)}/print?anonKey=${encodeURIComponent(anonKey)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { quantities: {} }))
      .then((data: { quantities: Record<string, number> }) =>
        setPrintSelections(new Map(Object.entries(data.quantities))),
      )
      .catch(() => undefined);

    return () => controller.abort();
  }, [allowPrintSelection, token]);

  // Which photos are this viewer's own uploads. Only fetched where uploading
  // was possible at all — on a read-only link nobody has anything to take back.
  useEffect(() => {
    if (!allowUpload) return;
    const anonKey = getViewerId();
    if (!anonKey) return;

    const controller = new AbortController();
    void fetchMyPhotoIds(token, anonKey, controller.signal).then((ids) => setMine(new Set(ids)));

    return () => controller.abort();
  }, [allowUpload, token]);

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

  const sendPrintQuantity = useCallback(
    async (photoId: string, quantity: number, displayName?: string) => {
      const anonKey = getViewerId();
      if (!anonKey) return;

      const response = await fetch(`/api/g/${encodeURIComponent(token)}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonKey, photoId, quantity, displayName }),
      });
      if (!response.ok) return;

      // The server is authoritative — a 0 sent while the row didn't exist
      // resolves the same way a rejected quantity would.
      const data = (await response.json()) as { quantity: number };
      setPrintSelections((prev) => {
        const copy = new Map(prev);
        if (data.quantity > 0) copy.set(photoId, data.quantity);
        else copy.delete(photoId);
        return copy;
      });
    },
    [token],
  );

  const adjustPrintQuantity = useCallback(
    (photoId: string, delta: 1 | -1) => {
      const current = printSelections.get(photoId) ?? 0;
      const next = clampPrintQuantity(current + delta);
      if (next === current) return;

      // Optimistic: the badge updates immediately, the server follows.
      setPrintSelections((prev) => {
        const copy = new Map(prev);
        if (next > 0) copy.set(photoId, next);
        else copy.delete(photoId);
        return copy;
      });

      // Same "join" moment as the heart — asked once, always skippable. Only
      // reachable on an increment: a decrement implies a copy was already
      // set, so the prompt was already shown or skipped.
      if (next > 0 && !getViewerName() && !hasAnsweredNamePrompt()) {
        setNamePromptFor(photoId);
        setPendingPrint(next);
        return;
      }

      void sendPrintQuantity(photoId, next, getViewerName() ?? undefined);
    },
    [printSelections, sendPrintQuantity],
  );

  const incrementPrintQuantity = useCallback(
    (photoId: string) => adjustPrintQuantity(photoId, 1),
    [adjustPrintQuantity],
  );
  const decrementPrintQuantity = useCallback(
    (photoId: string) => adjustPrintQuantity(photoId, -1),
    [adjustPrintQuantity],
  );

  const photoIds = useMemo(() => photos.map((photo) => photo.id), [photos]);
  const selectionActive = allowDownload && selection.ids.size > 0;

  // --- Justified, virtualized grid ------------------------------------
  const listRef = useRef<HTMLUListElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  /**
   * Both read together, from the same observer, on purpose: `offsetTop` is
   * not itself observable (ResizeObserver only reports the *size* of the
   * element it watches), but everything that can move the list's top offset
   * — the header/toolbar wrapping to another line, the toolbar's own content
   * changing between the idle and selection-active layouts — happens at the
   * exact same viewport-width breakpoints that change the list's own width.
   * Recomputing only one of the two on resize is what silently misaligns
   * every row a moment later.
   */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sync = () => {
      setContainerWidth(el.getBoundingClientRect().width);
      setScrollMargin(el.offsetTop);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    // The observer's own first callback covers the initial size, but not a
    // later offsetTop shift caused by sibling content changing height
    // without the list itself resizing (selection toggling the toolbar).
    sync();
    return () => observer.disconnect();
  }, [selectionActive]);

  const rows = useMemo<JustifiedRow<GalleryPhoto>[]>(() => {
    if (containerWidth <= 0) return [];
    return justifyRows(
      photos.map((photo) => ({ item: photo, aspect: aspectOf(photo) })),
      containerWidth,
      targetRowHeight(containerWidth),
      GAP,
      itemsPerRow(containerWidth),
    );
  }, [photos, containerWidth]);

  const rowVirtualizer = useWindowVirtualizer({
    count: rows.length + (hasNextPage ? 1 : 0),
    estimateSize: (index) => rows[index]?.height ?? targetRowHeight(containerWidth),
    overscan: 4,
    scrollMargin,
    gap: GAP,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const lastVisible = virtualRows.at(-1);
    if (!lastVisible) return;
    if (lastVisible.index >= rows.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [virtualRows, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Roving tabindex over a *virtualized* list: the target tile may not be
  // mounted yet, so moving to it is scroll-then-focus, not just focus. See
  // the effect below that watches `pendingFocusIndex`.
  const [rovingIndex, setRovingIndex] = useState(0);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const tileRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // `rowStarts[i]` is the flat photo index of row i's first tile — together
  // with `rowIndexForPhoto` this is enough to convert a flat index to a
  // (row, column) position and back, which ArrowUp/ArrowDown need below:
  // justified rows vary in length, so a flat-index step by "the current
  // row's length" over/undershoots into the wrong row.
  const { rowIndexForPhoto, rowStarts } = useMemo(() => {
    const rowIndexForPhoto = new Map<number, number>();
    const rowStarts: number[] = [];
    let seen = 0;
    rows.forEach((row, rowIndex) => {
      rowStarts.push(seen);
      row.items.forEach((_, offset) => rowIndexForPhoto.set(seen + offset, rowIndex));
      seen += row.items.length;
    });
    return { rowIndexForPhoto, rowStarts };
  }, [rows]);

  /**
   * The width each photo's tile was rendered at, so the lightbox can show that
   * exact thumbnail while the full-size image is still arriving.
   *
   * It has to be the *exact* width: `next/image` picks its srcset candidate
   * from `sizes`, so asking for the same src at a different size fetches a
   * different variant — a second download and a second billed transform,
   * instead of the one already sitting in the browser's cache because the
   * viewer just tapped it.
   */
  const tileWidths = useMemo(() => {
    const widths = new Map<string, number>();
    for (const row of rows) {
      for (const entry of row.items) widths.set(entry.item.id, entry.width);
    }
    return widths;
  }, [rows]);

  const onTileFocus = useCallback((index: number) => setRovingIndex(index), []);

  const moveRoving = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= photos.length) return;
      setRovingIndex(nextIndex);
      const existing = tileRefs.current.get(nextIndex);
      if (existing) {
        existing.focus();
        return;
      }
      const rowIndex = rowIndexForPhoto.get(nextIndex);
      if (rowIndex !== undefined) rowVirtualizer.scrollToIndex(rowIndex, { align: "center" });
      setPendingFocusIndex(nextIndex);
    },
    [photos.length, rowIndexForPhoto, rowVirtualizer],
  );

  useEffect(() => {
    if (pendingFocusIndex === null) return;
    const el = tileRefs.current.get(pendingFocusIndex);
    if (el) {
      el.focus();
      setPendingFocusIndex(null);
    }
  }, [pendingFocusIndex, virtualRows]);

  const onGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLUListElement>) => {
      const key = event.key;
      const isGridKey =
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "ArrowDown" ||
        key === "ArrowUp" ||
        key === "Home" ||
        key === "End";
      if (!isGridKey || photos.length === 0) return;
      event.preventDefault();

      if (key === "Home") return moveRoving(0);
      if (key === "End") return moveRoving(photos.length - 1);
      if (key === "ArrowRight") return moveRoving(Math.min(rovingIndex + 1, photos.length - 1));
      if (key === "ArrowLeft") return moveRoving(Math.max(rovingIndex - 1, 0));

      // ArrowDown/ArrowUp: move to the same visual column in the adjacent
      // row rather than stepping the flat index by a row's length — rows
      // vary in length (justified layout), so a flat step over/undershoots
      // into the wrong row from anywhere but the first column.
      const rowIndex = rowIndexForPhoto.get(rovingIndex);
      if (rowIndex === undefined) return;
      const targetRow = rowIndex + (key === "ArrowDown" ? 1 : -1);
      if (targetRow < 0 || targetRow >= rows.length) return;
      const column = rovingIndex - rowStarts[rowIndex]!;
      const targetColumn = Math.min(column, rows[targetRow]!.items.length - 1);
      moveRoving(rowStarts[targetRow]! + targetColumn);
    },
    [photos.length, rovingIndex, rows, rowIndexForPhoto, rowStarts, moveRoving],
  );

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
   * so "Stáhnout vše" and "Stáhnout vybrané" cannot drift apart, and it works
   * regardless of how much of the paginated grid has loaded client-side.
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
          // The UI message stays generic and calm either way — this is only
          // so a real failure is diagnosable from the console instead of a
          // guess, since the route's reason (no_photos, DOWNLOAD_DISABLED,
          // ZIP_NOT_CONFIGURED, ...) would otherwise be silently discarded.
          const body: unknown = await response.json().catch(() => null);
          const reason =
            body && typeof body === "object" && "error" in body ? body.error : response.status;
          console.error(`ZIP manifest request failed: ${String(reason)}`);
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
      } catch (error) {
        console.error("ZIP manifest request threw", error);
        setZipState("error");
      }
    },
    [token],
  );

  const openPhoto = useCallback(
    (index: number) => {
      setLightboxIndex(index);
      // A freshly opened photo shows its controls, however the last one was
      // left. Done here rather than in an effect: opening is an event, and an
      // effect would only re-derive it a render later.
      setChromeHidden(false);
      setZoomed(false);
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

  /**
   * `photos` is only the pages TanStack Query has fetched so far — the grid's
   * own scroll-triggered fetch (below) never fires while the lightbox is the
   * only thing visible. Wrapping modulo `photos.length` here would silently
   * loop back to photo 1 at the end of the loaded page, hiding every photo
   * past it. Instead: at the boundary, kick off the next page and hold in
   * place — the button's `disabled` state (below) reflects that a fetch is
   * in flight so it doesn't read as unresponsive.
   */
  const move = useCallback(
    (delta: number) => {
      lastDirection.current = delta > 0 ? 1 : -1;
      setZoomed(false);
      setLightboxIndex((current) => {
        if (current === null) return current;
        // Clamped on the way in for the same reason `activeIndex` is clamped
        // on the way out: the favourites filter can shrink the list under an
        // open lightbox.
        const requested = Math.min(current, photos.length - 1) + delta;
        if (requested >= photos.length) {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          return current;
        }
        const next = requested < 0 ? photos.length - 1 : requested;
        const photo = photos[next];
        if (photo && !reportedPhotos.current.has(photo.id)) {
          reportedPhotos.current.add(photo.id);
          report("PHOTO_VIEW", photo.id);
        }
        return next;
      });
    },
    [photos, report, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  /**
   * Unhearting the photo you are looking at, while the favourites filter is
   * on, takes it out of `photos` underneath the lightbox. Clamping here lands
   * on its neighbour instead of on nothing; when it was the only one left,
   * `active` goes null and the lightbox closes.
   */
  const activeIndex =
    lightboxIndex === null || photos.length === 0
      ? null
      : Math.min(lightboxIndex, photos.length - 1);
  const active = activeIndex === null ? null : photos[activeIndex];

  /**
   * The grid thumbnail to show under the opening photo. Null when the tile's
   * width isn't known — a photo can only be opened from a tile, so that means
   * the layout hasn't settled yet, and guessing a width here would fetch a
   * variant nothing else uses rather than reusing the cached one.
   */
  const preview = useMemo(() => {
    if (!active) return null;
    const width = tileWidths.get(active.id);
    if (!width) return null;
    return {
      src: srcFor(active.thumbObjectKey ?? active.objectKey, imageGrant),
      sizes: `${Math.ceil(width)}px`,
    };
  }, [active, imageGrant, tileWidths]);
  const activeSelected = active ? selection.ids.has(active.id) : false;
  const lightboxRef = useRef<HTMLDivElement>(null);
  const isLightboxOpen = lightboxIndex !== null;
  useFocusTrap(lightboxRef, isLightboxOpen);

  /**
   * One history entry per open lightbox, not per photo browsed inside it, so
   * the hardware/gesture back button on Android closes the lightbox instead
   * of leaving the gallery entirely. Every close path calls `history.back()`
   * rather than clearing the index directly (see `closeLightbox` below), so
   * opening and closing stay symmetric — popstate is the single place the
   * index actually becomes null.
   */
  useEffect(() => {
    if (!isLightboxOpen) return;
    window.history.pushState({ galleryLightbox: true }, "");
  }, [isLightboxOpen]);

  useEffect(() => {
    function onPopState() {
      setLightboxIndex(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const closeLightbox = useCallback(() => window.history.back(), []);

  const toggleChrome = useCallback(() => setChromeHidden((hidden) => !hidden), []);

  /** "15. 8. 2026 · 56 fotek", with either half omitted if it isn't known. */
  const subtitle = [eventDate, photoCount > 0 ? t("photoCount", { count: photoCount }) : null]
    .filter(Boolean)
    .join(" · ");

  /**
   * Tapping the photo puts the controls away, and zooming in does too: at that
   * point the viewer is looking at one corner of one photo, and a close button
   * over it is in the way of the only thing they asked for. Hidden means
   * non-interactive as well as invisible — chrome that is faded out but still
   * swallowing taps is worse than chrome that is simply there.
   */
  const chromeClasses =
    chromeHidden || zoomed
      ? "pointer-events-none opacity-0 transition-opacity duration-200"
      : "opacity-100 transition-opacity duration-200";

  /**
   * Takes back one of this viewer's own uploads. Irreversible, so it asks —
   * a plain `confirm()`, matching the rest of this codebase's dependency-free
   * UI. The server re-checks that the photo really is theirs; this is the
   * affordance, not the authorisation.
   */
  const deleteMine = useCallback(
    async (photoId: string) => {
      const anonKey = getViewerId();
      if (!anonKey) return;
      if (!confirm(t("deleteConfirm"))) return;

      setDeleting(true);
      try {
        const query = new URLSearchParams({ anonKey, photoId });
        const response = await fetch(
          `/api/g/${encodeURIComponent(token)}/mine?${query.toString()}`,
          { method: "DELETE" },
        );
        if (!response.ok) return;

        setMine((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        // The grid is a cached query; the row is gone server-side, so refetch
        // rather than splicing it out of every page by hand.
        closeLightbox();
        await queryClient.invalidateQueries({ queryKey: ["gallery-photos", token] });
      } finally {
        setDeleting(false);
      }
    },
    [closeLightbox, queryClient, t, token],
  );

  useEffect(() => {
    if (lightboxIndex === null) return;

    function onKey(event: KeyboardEvent) {
      // The name prompt can open on top of the lightbox (favoriting/reacting
      // from inside it) and owns its own Escape handling — without this, its
      // Escape bubbles here and closes the lightbox instead, orphaning the
      // prompt on screen. Typing while it's open must never reach these
      // shortcuts either, which is what previously toggled selection when a
      // viewer's name started with "s".
      if (namePromptFor) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape") closeLightbox();
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
  }, [allowDownload, closeLightbox, lightboxIndex, move, namePromptFor, photos, pick]);

  /**
   * Warms the next and previous photo while the current one is on screen,
   * plus a third one two steps further in whichever direction the viewer was
   * last moving — one-ahead alone always trails a viewer clicking "next"
   * faster than a preload can land, so fast repeated browsing kept stalling
   * on the swipe after the one this effect had time to warm.
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

    // No wrapping past either loaded end: the next page may not have landed
    // yet (see `move`, above) and, symmetrically, the "previous" of index 0
    // isn't the last loaded photo — wrapping would warm the wrong photo in
    // both directions.
    const inRange = (index: number) => index >= 0 && index < photos.length;
    const ahead = lightboxIndex + 2 * lastDirection.current;
    const neighbours = [
      inRange(lightboxIndex + 1) ? photos[lightboxIndex + 1] : undefined,
      inRange(lightboxIndex - 1) ? photos[lightboxIndex - 1] : undefined,
      inRange(ahead) ? photos[ahead] : undefined,
    ];

    const links = neighbours
      .filter((photo): photo is GalleryPhoto => photo !== undefined && photo.id !== active?.id)
      .map((photo) => {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.imageSrcset = fullWidthSrcSet(srcFor(photo.objectKey, imageGrant), imageLoader);
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
  }, [active?.id, lightboxIndex, photos, imageGrant]);

  // Edge to edge on a phone, and above `sm` only the grid's own 4 px gap as
  // an outer margin — the page edge matches the seam between two photos
  // instead of framing the grid, which is what Google Photos does.
  return (
    <main className="mx-auto max-w-[1600px] px-0 pt-5 pb-10 sm:px-1 sm:pt-10 sm:pb-14 lg:pt-12">
      <div aria-live="polite" className="sr-only">
        {selection.ids.size > 0 ? t("selectedCount", { count: selection.ids.size }) : ""}
      </div>
      <div aria-live="polite" className="sr-only">
        {zipState === "preparing" && t("zipPreparingAnnounce")}
        {zipState === "error" && t("zipErrorAnnounce")}
      </div>
      <header
        className={`${GUTTER} mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-5`}
      >
        <div>
          {backHref && (
            <a
              href={backHref}
              className="mb-1 inline-block text-sm text-neutral-500 underline dark:text-neutral-400"
            >
              ← {backLabel ?? t("back")}
            </a>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allowReactions && (favorites.size > 0 || favoritesOnly) && (
            <IconButton
              onClick={() => {
                // A selection carries positions as well as ids, and the filter
                // renumbers every position under it — shift-picking a range
                // afterwards would select photos nobody pointed at.
                setSelection(clearSelection());
                setFavoritesOnly((prev) => !prev);
              }}
              aria-pressed={favoritesOnly}
              label={String(favorites.size)}
              title={favoritesOnly ? t("showAllPhotos") : t("showFavoritesOnlyTitle")}
              className={favoritesOnly ? "border-brand-primary bg-brand-tint text-neutral-900" : ""}
            >
              <span className="sr-only">
                {favoritesOnly ? t("showAllPhotos") : t("showFavoritesOnlySr")}
              </span>
              <HeartIcon className="h-5 w-5" active={favoritesOnly} />
            </IconButton>
          )}
          {allPhotos.length > 0 && (
            <IconButton
              onClick={() => setProjecting(true)}
              label={t("slideshowButtonLabel")}
              title={t("slideshowButtonTitle")}
            >
              <ProjectorIcon />
            </IconButton>
          )}
          {/* Only ever rendered when it can actually do something: a
              single-photo gallery downloads directly, and a whole gallery needs
              its pre-built archive (docs/TODO.md §7) to exist. A disabled
              button explained only by a `title` is, on a phone, a dead control
              with no explanation at all. */}
          {allowDownload &&
            selection.ids.size === 0 &&
            (archiveZipUrl ? (
              // A pre-built archive is a plain CDN link — no signed manifest,
              // no Worker request, just a download.
              <IconButtonLink
                href={archiveZipUrl}
                label={t("downloadAllLabel")}
                title={t("downloadAllTitle")}
              >
                <DownloadIcon />
              </IconButtonLink>
            ) : (
              allPhotos.length === 1 && (
                <IconButton
                  disabled={zipState === "preparing"}
                  onClick={() => void downloadZip([])}
                  label={t("downloadOneLabel")}
                  title={t("downloadOneTitle")}
                >
                  <DownloadIcon />
                </IconButton>
              )
            ))}
          {allPhotos.length > 0 && (
            <OfflineIconButton
              token={token}
              objectKeys={allPhotos.map((photo) => photo.objectKey)}
            />
          )}
          <PresenceStrip galleryId={galleryId} optedOut={optedOut} />
          {viewers.length > 0 && <ViewerChips viewers={viewers} />}
          <LocaleSwitcher />
        </div>
      </header>

      {zipState === "error" && selection.ids.size === 0 && (
        <p className={`${GUTTER} -mt-1 mb-3 text-xs text-red-600`}>{t("zipErrorAnnounce")}</p>
      )}

      {allowDownload && photos.length > 0 && selection.ids.size > 0 && (
        <div className="sticky top-0 z-30 mb-3 flex flex-wrap items-center gap-3 border-b bg-white/90 px-4 py-3 backdrop-blur sm:-mx-1 dark:bg-neutral-950/90">
          <button
            type="button"
            onClick={() => setSelection(clearSelection())}
            aria-label={t("clearSelection")}
            // Same 44px icon-button shape as the lightbox's own close button.
            className="flex h-11 w-11 items-center justify-center rounded-full border transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {/* Same 20px glyph the lightbox's own close button uses. */}
            <CloseIcon className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selection.ids.size })}
          </span>
          <button
            type="button"
            onClick={() =>
              setSelection((prev) =>
                isAllSelected(prev, photoIds) ? clearSelection() : selectAll(photoIds),
              )
            }
            className="flex min-h-11 items-center text-sm underline"
          >
            {isAllSelected(selection, photoIds) ? t("deselectAll") : t("selectAllLoaded")}
          </button>
          <button
            type="button"
            disabled={zipState === "preparing"}
            onClick={() => void downloadZip(selectedInOrder(selection, photoIds))}
            className="ml-auto flex min-h-11 items-center rounded-full bg-neutral-900 px-4 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {zipState === "preparing"
              ? t("preparingShort")
              : t("downloadSelected", { count: selection.ids.size })}
          </button>
          {zipState === "error" && (
            <span className="w-full text-xs text-red-600">{t("zipErrorAnnounce")}</span>
          )}
        </div>
      )}

      {/* Real justified layout (src/lib/justified-layout.ts): every row is
          scaled to fill the width exactly at its own computed height, so no
          photo is cropped. Virtualized by row via useWindowVirtualizer — the
          page itself scrolls, not a boxed inner panel, matching the rest of
          the app. */}
      <ul
        ref={listRef}
        className="relative flex flex-col"
        style={{ height: rowVirtualizer.getTotalSize() }}
        aria-label={t("photosListAriaLabel")}
        onKeyDown={onGridKeyDown}
      >
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) {
            return (
              <li
                key="loading"
                aria-hidden
                className="absolute top-0 left-0 flex w-full items-center justify-center text-sm text-neutral-400"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                }}
              >
                {t("loadingMorePhotos")}
              </li>
            );
          }

          let indexOffset = 0;
          for (let i = 0; i < virtualRow.index; i += 1) indexOffset += rows[i]!.items.length;

          return (
            <li
              key={row.items[0]?.item.id ?? virtualRow.index}
              className="absolute top-0 left-0 flex w-full"
              style={{
                height: virtualRow.size,
                gap: GAP,
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              {row.items.map((entry, offset) => {
                const index = indexOffset + offset;
                const photo = entry.item;
                return (
                  <PhotoTile
                    key={photo.id}
                    photo={photo}
                    // The grid prefers the browser-made thumbnail: already the
                    // right size, so it costs no Cloudflare transformation
                    // (docs/GUEST-GALLERIES.md §9). Null on photos uploaded by a
                    // device that could not make one, which fall back to the
                    // transformed original exactly as before.
                    src={srcFor(photo.thumbObjectKey ?? photo.objectKey, imageGrant)}
                    width={entry.width}
                    height={entry.height}
                    index={index}
                    priority={virtualRow.index === 0}
                    tabbable={index === rovingIndex}
                    selectionActive={selectionActive}
                    selected={selection.ids.has(photo.id)}
                    allowDownload={allowDownload}
                    allowReactions={allowReactions}
                    allowPrintSelection={allowPrintSelection}
                    isFavorite={favorites.has(photo.id)}
                    favoriteCount={counts.get(photo.id) ?? photo.favoriteCount}
                    reactionState={reactions.get(photo.id)}
                    printQuantity={printSelections.get(photo.id) ?? 0}
                    onPick={pick}
                    onOpen={openPhoto}
                    onToggleFavorite={toggleFavorite}
                    onIncrementPrint={incrementPrintQuantity}
                    onDecrementPrint={decrementPrintQuantity}
                    onFocus={onTileFocus}
                    buttonRef={(el) => {
                      if (el) tileRefs.current.set(index, el);
                      else tileRefs.current.delete(index);
                    }}
                  />
                );
              })}
            </li>
          );
        })}
      </ul>

      {photos.length === 0 && (
        <p className={`${GUTTER} text-sm text-neutral-500 dark:text-neutral-400`}>
          {!favoritesOnly
            ? t("emptyGallery")
            : hasNextPage
              ? t("searchingFavorites")
              : t("noFavoritesYet")}
        </p>
      )}

      {active && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("lightboxAriaLabel", { index: activeIndex! + 1, total: photos.length })}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 outline-none"
          onClick={closeLightbox}
        >
          <LightboxPhoto
            photo={active}
            src={srcFor(active.objectKey, imageGrant)}
            preview={preview}
            loaded={loadedPhotoId === active.id}
            selected={activeSelected}
            onLoad={() => setLoadedPhotoId(active.id)}
            onSwipe={move}
            onDismiss={closeLightbox}
            onTap={toggleChrome}
            onZoomChange={setZoomed}
          />

          <NavButton
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
            className={`absolute left-0 ${chromeClasses}`}
            aria-label={t("previous")}
          >
            <ChevronLeftIcon />
          </NavButton>
          <NavButton
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
            disabled={activeIndex! >= photos.length - 1 && !hasNextPage}
            className={`absolute right-0 ${chromeClasses}`}
            aria-label={t("next")}
          >
            <ChevronRightIcon />
          </NavButton>
          <div
            className={`absolute inset-x-0 top-0 flex items-center gap-3 p-4 ${chromeClasses}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-md">
              <button
                type="button"
                onClick={closeLightbox}
                aria-label={t("close")}
                className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
              >
                <CloseIcon className="h-5 w-5" />
              </button>

              {mine.has(active.id) && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void deleteMine(active.id)}
                  className="flex h-11 items-center rounded-full px-3 text-sm text-white transition-colors hover:bg-white/15 disabled:opacity-50"
                >
                  {deleting ? t("deleting") : t("deleteMyPhoto")}
                </button>
              )}

              {allowDownload && (
                <button
                  type="button"
                  onClick={() => pick(activeIndex!, active.id, false)}
                  aria-pressed={activeSelected}
                  aria-label={activeSelected ? t("selected") : t("select")}
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors ${
                    activeSelected ? "" : "hover:bg-white/15"
                  }`}
                >
                  {activeSelected ? (
                    <CheckCircleIcon className="text-brand-primary h-5 w-5" />
                  ) : (
                    <CheckIcon className="h-5 w-5" />
                  )}
                </button>
              )}
            </div>

            {/* `photoCount` is the gallery's real, server-side total — unlike
                `photos.length`, it doesn't depend on how many pages of the
                infinite scroll have loaded yet, so the counter never needs a
                "+" to hedge an incomplete count. Favoriting filters the list
                to a subset `photoCount` doesn't describe, so that case keeps
                the old loaded-so-far behaviour. */}
            <span className="ml-auto rounded-full bg-black/40 px-3 py-1.5 text-sm text-white/70 tabular-nums backdrop-blur-md">
              {activeIndex! + 1} / {favoritesOnly ? photos.length : photoCount}
              {favoritesOnly && hasNextPage && "+"}
            </span>
          </div>

          <div
            className={`absolute bottom-4 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-md ${chromeClasses}`}
            onClick={(event) => event.stopPropagation()}
          >
            {allowReactions && (
              <>
                <HeartButton
                  active={favorites.has(active.id)}
                  count={counts.get(active.id) ?? active.favoriteCount}
                  onClick={() => toggleFavorite(active.id)}
                  size="lg"
                  bare
                />
                <ReactionBar
                  state={reactions.get(active.id)}
                  onPick={(kind) => toggleReaction(active.id, kind)}
                />
              </>
            )}
            {allowPrintSelection && (
              <PrinterButton
                quantity={printSelections.get(active.id) ?? 0}
                onIncrement={() => incrementPrintQuantity(active.id)}
                onDecrement={() => decrementPrintQuantity(active.id)}
                size="lg"
                bare
              />
            )}
            {allowDownload && (
              <button
                type="button"
                disabled={zipState === "preparing"}
                onClick={() => void downloadZip([active.id])}
                aria-label={
                  zipState === "preparing" ? t("preparingDownload") : t("downloadOriginal")
                }
                className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                <DownloadIcon className="h-5 w-5" />
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
            const printQuantity = pendingPrint;
            setNamePromptFor(null);
            setPendingReaction(null);
            setPendingPrint(null);
            if (name) setViewerName(name);
            else dismissNamePrompt();

            // The prompt interrupts exactly one action; resume that one only.
            if (kind) void sendReaction(photoId, kind, name || undefined);
            else if (printQuantity !== null)
              void sendPrintQuantity(photoId, printQuantity, name || undefined);
            else void sendFavorite(photoId, true, name || undefined);
          }}
        />
      )}

      <footer className="mx-4 mt-10 border-t pt-4 text-xs text-neutral-500 sm:mx-3 dark:text-neutral-400">
        {!optedOut ? (
          <p>
            {t("privacyNotice")}{" "}
            <button type="button" className="underline" onClick={optOut}>
              {t("optOut")}
            </button>
          </p>
        ) : (
          <p>{t("optedOutNotice")}</p>
        )}
      </footer>

      {projecting && (
        <Slideshow
          photos={allPhotos}
          imageGrant={imageGrant}
          onClose={() => setProjecting(false)}
          onRefresh={() => {
            void queryClient.invalidateQueries({ queryKey: ["gallery-photos", token] });
          }}
        />
      )}

      {allowUpload && (
        <GuestUploader
          token={token}
          onUploaded={async () => {
            await queryClient.invalidateQueries({ queryKey: ["gallery-photos", token] });
            // Newly uploaded photos are deletable straight away, so the
            // "mine" set has to catch up with what just landed.
            const anonKey = getViewerId();
            if (anonKey) setMine(new Set(await fetchMyPhotoIds(token, anonKey)));
          }}
        />
      )}
    </main>
  );
}

interface PhotoTileProps {
  photo: GalleryPhoto;
  src: string;
  width: number;
  height: number;
  index: number;
  priority: boolean;
  tabbable: boolean;
  selectionActive: boolean;
  selected: boolean;
  allowDownload: boolean;
  allowReactions: boolean;
  allowPrintSelection: boolean;
  isFavorite: boolean;
  favoriteCount: number;
  reactionState: PhotoReactionState | undefined;
  printQuantity: number;
  onPick: (index: number, id: string, shiftKey: boolean) => void;
  onOpen: (index: number) => void;
  onToggleFavorite: (photoId: string) => void;
  onIncrementPrint: (photoId: string) => void;
  onDecrementPrint: (photoId: string) => void;
  onFocus: (index: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

/**
 * Memoized so a state change anywhere else in the gallery (a favorite on a
 * different photo, the selection toolbar, the lightbox) doesn't re-render
 * every other tile — only the primitives a specific tile actually depends on
 * are passed in, and every callback is a stable top-level reference.
 */
const PhotoTile = memo(function PhotoTile({
  photo,
  src,
  width,
  height,
  index,
  priority,
  tabbable,
  selectionActive,
  selected,
  allowDownload,
  allowReactions,
  allowPrintSelection,
  isFavorite,
  favoriteCount,
  reactionState,
  printQuantity,
  onPick,
  onOpen,
  onToggleFavorite,
  onIncrementPrint,
  onDecrementPrint,
  onFocus,
  buttonRef,
}: PhotoTileProps) {
  const t = useTranslations("gallery");
  // Local to this tile, not shared — a touch gesture and the synthetic click
  // that follows it always target the same DOM node, so there is no reason
  // for this to live in the parent (and mutating a ref passed down as a prop
  // is against the rules-of-hooks lint now enforced here).
  const longPress = useRef<{ timer: number | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  const cancelLongPress = useCallback(() => {
    if (longPress.current.timer !== null) {
      clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
    }
  }, []);

  return (
    <div
      className="group relative shrink-0 select-none"
      style={{ width, height }}
      onTouchStart={() => {
        if (!allowDownload) return;
        longPress.current.fired = false;
        longPress.current.timer = window.setTimeout(() => {
          longPress.current.fired = true;
          onPick(index, photo.id, false);
        }, LONG_PRESS_MS);
      }}
      onTouchMove={cancelLongPress}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      // A long press otherwise raises the browser's "save image" sheet on top
      // of the selection we just made.
      onContextMenu={(event) => {
        if (selectionActive) event.preventDefault();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => onFocus(index)}
        onClick={(event) => {
          // The long press already acted; the click it synthesises must not
          // toggle the same photo straight back off.
          if (longPress.current.fired) {
            longPress.current.fired = false;
            return;
          }
          // While a selection is active the tile extends it rather than
          // opening the lightbox — otherwise picking 40 photos means 40
          // precise taps on a small circle.
          if (selectionActive) {
            onPick(index, photo.id, event.shiftKey);
            return;
          }
          onOpen(index);
        }}
        // Selected uses one fixed brand colour for every tile — matching the
        // checkbox's own `bg-brand-primary` — instead of each photo's own
        // placeholder colour showing through the frame the shrink leaves.
        // Unselected keeps that placeholder as its background so the grid
        // still fills in with the picture's own palette instead of grey
        // holes while the photo is loading.
        className={`relative block h-full w-full overflow-hidden ${selected ? "bg-brand-primary" : ""}`}
        style={selected ? undefined : { backgroundColor: placeholderStyle(photo.placeholder) }}
        aria-label={
          selectionActive
            ? t("selectPhoto", { fileName: photo.fileName })
            : t("openPhoto", { fileName: photo.fileName })
        }
      >
        <Image
          // The button around this image is what a screen reader announces
          // (`aria-label` below); an `alt` here would read "DSC_1234.jpg"
          // straight after it, which tells nobody anything.
          alt=""
          src={src}
          fill
          sizes={`${Math.ceil(width)}px`}
          priority={priority}
          // A real justified layout — object-contain would letterbox a tile
          // sized to the photo's own aspect ratio, so `fill` + the exact
          // rendered box is enough; no crop, no letterbox.
          className={`object-cover transition-transform duration-200 ${
            selected ? "scale-90" : "hover:scale-105"
          }`}
        />
      </button>
      {allowDownload && (
        <SelectCheck
          selected={selected}
          pinned={selectionActive}
          onPick={(shiftKey) => onPick(index, photo.id, shiftKey)}
          fileName={photo.fileName}
        />
      )}
      {allowPrintSelection && (
        <PrinterButton
          quantity={printQuantity}
          onIncrement={() => onIncrementPrint(photo.id)}
          onDecrement={() => onDecrementPrint(photo.id)}
          className="absolute top-2 right-2"
        />
      )}
      {allowReactions && (
        <>
          <HeartButton
            active={isFavorite}
            count={favoriteCount}
            onClick={() => onToggleFavorite(photo.id)}
            className="absolute right-2 bottom-2"
          />
          <ReactionBadge state={reactionState} />
        </>
      )}
    </div>
  );
});

/**
 * The heart, on a tile and in the lightbox.
 *
 * On a tile it is deliberately almost nothing: a white heart with a shadow, no
 * disc behind it. The disc it used to have put a 44 px dark circle on top of
 * every photo in the gallery — the same objection `SelectCheck` below is
 * already written to avoid — and a wedding gallery is not improved by five
 * hundred of them sitting on people's faces. An unset heart therefore stays
 * dim on touch and fades in on hover with a mouse; a *set* one is always at
 * full strength, because that one is information rather than an affordance.
 */
function HeartButton({
  active,
  count,
  onClick,
  className = "",
  size = "sm",
  bare = false,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  className?: string;
  /** "lg" is the lightbox's larger badge; "sm" (default) is the compact grid-tile badge — both keep a ≥44px touch target. */
  size?: "sm" | "lg";
  /** True inside the lightbox's shared blurred bar, which already supplies the background. */
  bare?: boolean;
}) {
  const t = useTranslations("gallery");
  const sizeClasses =
    size === "lg"
      ? "min-h-11 min-w-11 px-2.5 py-1.5 text-sm"
      : "min-h-11 min-w-11 px-2 py-1 text-xs drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]";
  const restingClasses = bare
    ? "hover:bg-white/15"
    : // Fades in under a mouse; a touch screen has no hover to wait for, so
      // there it sits quietly at 60% rather than disappearing entirely.
      "opacity-60 pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? t("removeFromFavorites") : t("addToFavorites")}
      className={`flex items-center justify-center gap-1 rounded-full text-white transition-opacity ${sizeClasses} ${
        active && !bare ? "opacity-100" : restingClasses
      } ${className}`}
    >
      <HeartIcon className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} active={active} />
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

/**
 * The printer, top-right on a tile and in the lightbox.
 *
 * Unset, it is a single round tap target — same "almost nothing" treatment
 * as HeartButton above. The first tap sets one copy, which is where this
 * used to stop: a second tap on the same spot meant "one more copy," so
 * undoing a misclick meant clicking through the whole range again up to 99.
 * Once a quantity is set it therefore expands into a stepper — minus, count,
 * plus — the same "Add" → quantity-stepper switch used by cart UIs (Uber
 * Eats, Instacart, most grocery-delivery apps): a single control that both
 * sets and corrects a count, with the correction exactly as cheap as the
 * mistake. Minus at 1 removes the selection and the stepper collapses back
 * to the plain icon.
 */
function PrinterButton({
  quantity,
  onIncrement,
  onDecrement,
  className = "",
  size = "sm",
  bare = false,
}: {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  className?: string;
  size?: "sm" | "lg";
  /** True inside the lightbox's shared blurred bar, which already supplies the background. */
  bare?: boolean;
}) {
  const t = useTranslations("gallery");
  const active = quantity > 0;

  if (!active) {
    const idleSizeClasses =
      size === "lg" ? "h-11 w-11" : "h-11 w-11 drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]";
    const restingClasses = bare
      ? "hover:bg-white/15"
      : // Fades in under a mouse; a touch screen has no hover to wait for, so
        // there it sits quietly at 60% rather than disappearing entirely.
        "opacity-60 pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
    return (
      <button
        type="button"
        onClick={onIncrement}
        aria-label={t("markForPrint")}
        className={`flex items-center justify-center rounded-full text-white transition-opacity ${idleSizeClasses} ${restingClasses} ${className}`}
      >
        <PrinterIcon className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
      </button>
    );
  }

  // Active: always fully visible (this is now information, not just an
  // affordance) and always the same three-segment stepper on touch and with
  // a mouse alike — no state that only reveals itself on hover, since a
  // phone has no hover to reveal it.
  //
  // Apple HIG, Buttons: "a button needs a hit region of at least 44x44 pt...
  // as a general rule" — no carve-out for grouped controls, so every segment
  // stays at 44px even on a tile. Checked against the tile grid's own
  // narrowest realistic width (2-up on a phone, src/components/gallery-view.tsx
  // `itemsPerRow`): the stepper's ~140px still clears the select checkbox in
  // the opposite corner with room to spare.
  const stepBtnSize = "h-11 w-11";
  // Same sm/lg glyph sizes as every other icon in the app (Heart, Printer,
  // the select checkmark) — the stepper icons had drifted a notch smaller.
  const stepIconSize = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <div
      role="group"
      aria-label={t("printQuantity", { count: quantity })}
      className={`flex items-center rounded-full text-white ${bare ? "bg-white/10" : "bg-black/55"} ${className}`}
    >
      <button
        type="button"
        onClick={onDecrement}
        aria-label={t("decreasePrintQuantity")}
        className={`flex items-center justify-center rounded-full hover:bg-white/20 ${stepBtnSize}`}
      >
        <MinusIcon className={stepIconSize} />
      </button>
      <span
        className={`tabular-nums ${size === "lg" ? "min-w-[1.5em] text-sm" : "min-w-[1.25em] text-xs"} text-center`}
        aria-live="polite"
      >
        {quantity}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={quantity >= MAX_PRINT_QUANTITY}
        aria-label={t("increasePrintQuantity")}
        className={`flex items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent ${stepBtnSize}`}
      >
        <PlusIcon className={stepIconSize} />
      </button>
    </div>
  );
}

/**
 * The circular checkbox, top-left, as in Google Photos.
 *
 * Hidden until hover on pointer devices — 500 permanent circles would shout
 * over the photos. Tailwind 4 gates `hover:` behind `(hover: hover)`, so on a
 * phone the hover rule never fires and the checkbox appears only once
 * selection mode has been entered by long press.
 *
 * Same `CheckIcon` glyph, same size, in both states — like `HeartIcon`'s own
 * `active` toggle, selection doesn't swap to a different icon, so it never
 * visibly grows or shrinks when picked. `text-brand-primary` alone read as
 * barely-there on some photos, so selected adds a plain white ring — the
 * same 44px the tap zone already is, `border-2`, no fill — around the same
 * glyph instead of trying to make the glyph's own colour carry all the
 * contrast.
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
  const t = useTranslations("gallery");
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={t("selectPhoto", { fileName })}
      // Stops the tile's own handler from also firing and opening the lightbox.
      onClick={(event) => {
        event.stopPropagation();
        onPick(event.shiftKey);
      }}
      className={`absolute top-2 left-2 flex h-11 w-11 items-center justify-center rounded-full border-2 transition-opacity ${
        selected
          ? "border-white opacity-100"
          : pinned
            ? "border-transparent opacity-100"
            : "border-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
    >
      <CheckIcon className="h-4 w-4 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]" />
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
  const reactionLabels = useReactionLabels();
  return (
    <div className="flex items-center gap-1">
      {REACTION_KINDS.map((kind) => {
        const count = state?.counts[kind] ?? 0;
        const mine = state?.mine === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            aria-pressed={mine}
            aria-label={reactionLabels[kind]}
            title={reactionLabels[kind]}
            className={`flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-sm transition-transform ${
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
  const t = useTranslations("gallery");
  return (
    <div className="flex items-center -space-x-2" aria-label={t("viewerChipsAriaLabel")}>
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
  const t = useTranslations("gallery");
  const [value, setValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, true);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
      tabIndex={-1}
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 outline-none"
      onKeyDown={(event) => {
        // Owns its own Escape rather than letting it bubble to a lightbox
        // that might be open underneath — see the note in the lightbox's
        // keydown handler above.
        if (event.key === "Escape") {
          event.stopPropagation();
          onSubmit("");
        }
      }}
    >
      <form
        className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 dark:bg-neutral-900"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value.trim());
        }}
      >
        <h2 id="name-prompt-title" className="text-lg font-semibold">
          {t("namePromptTitle")}
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("namePromptHint")}</p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={60}
          placeholder={t("namePromptPlaceholder")}
          className="w-full rounded border px-3 py-2"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onSubmit("")}>
            {t("namePromptSkip")}
          </Button>
          <Button type="submit">{t("namePromptSave")}</Button>
        </div>
      </form>
    </div>
  );
}
