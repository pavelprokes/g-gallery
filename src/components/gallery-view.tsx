"use client";

import Image from "next/image";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
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
import { FORMS, pluralize } from "@/lib/czech-plural";
import imageLoader from "@/lib/image-loader";
import { fullWidthSrcSet } from "@/lib/image-sizes";
import { placeholderStyle } from "@/lib/placeholder";
import { justifyRows, type JustifiedRow } from "@/lib/justified-layout";
import { srcFor } from "@/lib/image-src";
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
  ProjectorIcon,
} from "@/components/ui/icons";
import type { SignedImageGrant } from "@/lib/image-signing";
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
 * or leave a seam. */
const GAP = 8;

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
  initialPhotos: GalleryPhoto[];
  initialCursor: string | null;
  imageGrant: SignedImageGrant | null;
  viewers: GalleryViewer[];
  allowDownload: boolean;
  allowReactions: boolean;
  /** Share link lets whoever holds it add photos (docs/GUEST-GALLERIES.md §6). */
  allowUpload: boolean;
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
  initialPhotos,
  initialCursor,
  imageGrant,
  viewers,
  allowDownload,
  allowReactions,
  allowUpload,
  archiveZipUrl,
  backHref,
  backLabel,
}: GalleryViewProps) {
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
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Which way the viewer was last moving through the lightbox — the preload
  // effect uses this to warm a photo two steps ahead, not just one, so fast
  // repeated next/prev doesn't keep outrunning the network by exactly one.
  const lastDirection = useRef<1 | -1>(1);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [zipState, setZipState] = useState<"idle" | "preparing" | "error">("idle");

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

  const photos = useMemo(() => data.pages.flatMap((page) => page.items), [data]);

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
      setLightboxIndex((current) => {
        if (current === null) return current;
        const requested = current + delta;
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

  const active = lightboxIndex === null ? null : photos[lightboxIndex];
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
      if (!confirm("Smazat tuhle fotku z alba? Tohle už nejde vzít zpět.")) return;

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
    [closeLightbox, queryClient, token],
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

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <div aria-live="polite" className="sr-only">
        {selection.ids.size > 0 ? pluralize(selection.ids.size, FORMS.selected) : ""}
      </div>
      <div aria-live="polite" className="sr-only">
        {zipState === "preparing" && "Připravuji stažení…"}
        {zipState === "error" && "Stažení se nepodařilo připravit. Zkus to prosím znovu."}
      </div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {backHref && (
            <a
              href={backHref}
              className="mb-1 inline-block text-sm text-neutral-500 underline dark:text-neutral-400"
            >
              ← {backLabel ?? "Zpět"}
            </a>
          )}
          <h1 className="text-2xl font-semibold">{title}</h1>
          {eventDate && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{eventDate}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {photos.length > 0 && (
            <IconButton
              onClick={() => setProjecting(true)}
              aria-label="Projekce"
              title="Fotky na plátno — mění se samy, nové přibývají živě"
            >
              <ProjectorIcon />
            </IconButton>
          )}
          {allowDownload &&
            photos.length > 0 &&
            selection.ids.size === 0 &&
            (photos.length > 1 && archiveZipUrl ? (
              // A pre-built archive (docs/TODO.md §7) is a plain CDN link —
              // no signed manifest, no Worker request, just a download.
              <IconButtonLink
                href={archiveZipUrl}
                aria-label="Stáhnout vše (ZIP)"
                title="Stáhnout vše (ZIP)"
              >
                <DownloadIcon />
              </IconButtonLink>
            ) : (
              <IconButton
                disabled={zipState === "preparing" || photos.length > 1}
                onClick={() => void downloadZip([])}
                aria-label={photos.length > 1 ? "Archiv se připravuje" : "Stáhnout fotku"}
                title={
                  photos.length > 1
                    ? "Archiv se připravuje na pozadí — zkus to znovu za pár minut."
                    : "Stáhnout fotku"
                }
              >
                <DownloadIcon />
              </IconButton>
            ))}
          {photos.length > 0 && (
            <OfflineIconButton token={token} objectKeys={photos.map((photo) => photo.objectKey)} />
          )}
          <PresenceStrip galleryId={galleryId} optedOut={optedOut} />
          {viewers.length > 0 && <ViewerChips viewers={viewers} />}
        </div>
      </header>

      {zipState === "error" && selection.ids.size === 0 && (
        <p className="-mt-4 mb-4 text-xs text-red-600">
          Stažení se nepodařilo připravit. Zkus to prosím znovu.
        </p>
      )}

      {allowDownload && photos.length > 0 && selection.ids.size > 0 && (
        <div className="sticky top-0 z-30 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b bg-white/90 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 dark:bg-neutral-950/90">
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
            {isAllSelected(selection, photoIds) ? "Odznačit vše" : "Vybrat vše načtené"}
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
          {zipState === "error" && (
            <span className="w-full text-xs text-red-600">
              Stažení se nepodařilo připravit. Zkus to prosím znovu.
            </span>
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
        aria-label="Fotky v galerii"
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
                Načítám další fotky…
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
                    isFavorite={favorites.has(photo.id)}
                    favoriteCount={counts.get(photo.id) ?? photo.favoriteCount}
                    reactionState={reactions.get(photo.id)}
                    onPick={pick}
                    onOpen={openPhoto}
                    onToggleFavorite={toggleFavorite}
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
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          V galerii zatím nejsou žádné fotky.
        </p>
      )}

      {active && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label={active.fileName}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 outline-none"
          onClick={closeLightbox}
        >
          <div
            className="relative h-full w-full touch-pan-y bg-black"
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
              src={srcFor(active.objectKey, imageGrant)}
              alt={active.fileName}
              fill
              sizes="100vw"
              onLoad={() => setLoadedPhotoId(active.id)}
              className={`object-contain transition-all duration-200 ${
                activeSelected ? "scale-[0.93]" : ""
              } ${loadedPhotoId === active.id ? "opacity-100" : "opacity-0"}`}
              priority
            />
            {activeSelected && (
              // Inset ring rather than a border on the image: the image is
              // object-contain, so a border would frame the letterboxing, not
              // the photo.
              <span
                aria-hidden
                className="ring-brand-border/80 pointer-events-none absolute inset-4 rounded-lg ring-4 ring-inset"
              />
            )}
          </div>

          <NavButton
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
            className="absolute left-0"
            aria-label="Předchozí"
          >
            <ChevronLeftIcon />
          </NavButton>
          <NavButton
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
            disabled={lightboxIndex! >= photos.length - 1 && !hasNextPage}
            className="absolute right-0"
            aria-label="Další"
          >
            <ChevronRightIcon />
          </NavButton>
          <div
            className="absolute inset-x-0 top-0 flex items-center gap-3 p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-md">
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Zavřít"
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
                  {deleting ? "Mažu…" : "Smazat mou fotku"}
                </button>
              )}

              {allowDownload && (
                <button
                  type="button"
                  onClick={() => pick(lightboxIndex!, active.id, false)}
                  aria-pressed={activeSelected}
                  aria-label={activeSelected ? "Vybráno" : "Vybrat"}
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

            <span className="ml-auto text-sm text-white/70 tabular-nums">
              {lightboxIndex! + 1} / {photos.length}
              {hasNextPage && "+"}
            </span>
          </div>

          <div
            className="absolute bottom-4 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-md"
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
            {allowDownload && (
              <button
                type="button"
                disabled={zipState === "preparing"}
                onClick={() => void downloadZip([active.id])}
                aria-label={zipState === "preparing" ? "Připravuji stažení" : "Stáhnout originál"}
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

      <footer className="mt-10 border-t pt-4 text-xs text-neutral-500 dark:text-neutral-400">
        {!optedOut ? (
          <p>
            Návštěvu počítáme anonymně, jen přes tenhle prohlížeč — bez IP adresy.{" "}
            <button type="button" className="underline" onClick={optOut}>
              Nepočítat mě
            </button>
          </p>
        ) : (
          <p>Tvoje návštěvy se nepočítají.</p>
        )}
      </footer>

      {projecting && (
        <Slideshow
          photos={photos}
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
  isFavorite: boolean;
  favoriteCount: number;
  reactionState: PhotoReactionState | undefined;
  onPick: (index: number, id: string, shiftKey: boolean) => void;
  onOpen: (index: number) => void;
  onToggleFavorite: (photoId: string) => void;
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
  isFavorite,
  favoriteCount,
  reactionState,
  onPick,
  onOpen,
  onToggleFavorite,
  onFocus,
  buttonRef,
}: PhotoTileProps) {
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
        className="relative block h-full w-full overflow-hidden rounded-xl"
        // The tile carries the photo's own average colour, so the grid fills
        // in with the picture's palette instead of grey holes.
        style={{ backgroundColor: placeholderStyle(photo.placeholder) }}
        aria-label={selectionActive ? `Vybrat ${photo.fileName}` : `Otevřít ${photo.fileName}`}
      >
        <Image
          src={src}
          alt={photo.fileName}
          fill
          sizes={`${Math.ceil(width)}px`}
          priority={priority}
          // A real justified layout — object-contain would letterbox a tile
          // sized to the photo's own aspect ratio, so `fill` + the exact
          // rendered box is enough; no crop, no letterbox.
          className={`object-cover transition-transform duration-200 ${
            selected ? "scale-90 rounded-xl" : "hover:scale-105"
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
  const sizeClasses =
    size === "lg"
      ? "min-h-11 min-w-11 px-2.5 py-1.5 text-sm"
      : "min-h-11 min-w-11 px-2 py-1 text-xs";
  const chromeClasses = bare
    ? "hover:bg-white/15"
    : "bg-black/40 backdrop-blur-sm hover:bg-black/55";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
      className={`flex items-center justify-center gap-1 rounded-full text-white transition-colors ${sizeClasses} ${chromeClasses} ${className}`}
    >
      <HeartIcon className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} active={active} />
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
          ? "bg-brand-primary border-white text-white opacity-100"
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
            aria-label={REACTION_LABEL[kind]}
            title={REACTION_LABEL[kind]}
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
          Kdo se dívá?
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Jméno uvidí ostatní u tvých oblíbených fotek. Můžeš ho i přeskočit.
        </p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={60}
          placeholder="Např. Petra"
          className="w-full rounded border px-3 py-2"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onSubmit("")}>
            Přeskočit
          </Button>
          <Button type="submit">Uložit</Button>
        </div>
      </form>
    </div>
  );
}
