"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { originalUrl } from "@/lib/photo-url";
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

export interface GalleryPhoto {
  id: string;
  objectKey: string;
  fileName: string;
  width: number | null;
  height: number | null;
  favoriteCount: number;
}

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
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, move]);

  const active = lightboxIndex === null ? null : photos[lightboxIndex];

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {eventDate && <p className="text-sm text-neutral-500">{eventDate}</p>}
        </div>
        {viewers.length > 0 && <ViewerChips viewers={viewers} />}
      </header>

      {/* Justified rows: each tile grows in proportion to its aspect ratio, so
          a row fills the width exactly at a near-constant height. The zero-height
          spacers stop the final row from stretching its few photos. */}
      <ul className="flex flex-wrap gap-2">
        {photos.map((photo, index) => {
          const aspect = aspectOf(photo);
          return (
            <li
              key={photo.id}
              className="relative h-36 sm:h-48 lg:h-52"
              style={{ flexGrow: aspect, flexBasis: `${aspect * ROW_HEIGHT}px` }}
            >
              <button
                type="button"
                onClick={() => openPhoto(index)}
                className="relative block h-full w-full overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900"
                aria-label={`Otevřít ${photo.fileName}`}
              >
                <Image
                  src={photo.objectKey}
                  alt={photo.fileName}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover transition-transform duration-200 hover:scale-105"
                />
              </button>
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
              className="object-contain"
              priority
            />
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
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-2 text-white"
            aria-label="Zavřít"
          >
            ✕
          </button>

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
              <a
                href={originalUrl(active.objectKey)}
                download={active.fileName}
                className="rounded-full bg-white/10 px-4 py-2 text-sm text-white"
              >
                Stáhnout originál
              </a>
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

      <footer className="mt-10 border-t pt-4 text-xs text-neutral-500">
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
