"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryPhoto } from "@/components/gallery-view";
import type { SignedImageGrant } from "@/lib/image-signing";
import { srcFor } from "@/lib/image-src";
import { holdScreenAwake } from "@/lib/wake-lock";

/**
 * The projection for the party (docs/GUEST-GALLERIES.md, F5): photos on the
 * venue's screen, changing by themselves, with nothing to operate.
 *
 * Deliberately without controls. This runs on a projector nobody is standing
 * next to — arrows, counters and a scrubber would only be things for a guest
 * to poke at. Escape or a click leaves; that is the whole interface.
 */
const ADVANCE_MS = 6_000;
const FADE_MS = 1_200;
/** How often to look for photos guests have added since this started. */
const REFRESH_MS = 30_000;

export function Slideshow({
  photos,
  imageGrant,
  onClose,
  onRefresh,
}: {
  photos: GalleryPhoto[];
  imageGrant: SignedImageGrant | null;
  onClose: () => void;
  /** Pulls in whatever arrived since — this is what makes it *live*. */
  onRefresh: () => void;
}) {
  // Two mounted layers, crossfaded by flipping which one is on top. The
  // incoming photo is put in the hidden layer a full interval before it is
  // shown, so it is decoded by the time it fades in — a single <img> whose src
  // changes flashes white on a slow connection, which on a five-metre screen is
  // the one thing everyone notices.
  const [slots, setSlots] = useState<[GalleryPhoto | null, GalleryPhoto | null]>([
    photos[0] ?? null,
    photos[1] ?? null,
  ]);
  const [active, setActive] = useState(0);

  // Ids already projected this pass. New photos are never in it, so they are
  // picked first — a guest's shot reaching the screen a few seconds after they
  // upload it is the entire point of doing this live.
  const shown = useRef(new Set<string>(photos[0] ? [photos[0].id] : []));
  // Read by the interval, which must see the latest list without being torn
  // down and restarted every time a guest uploads — restarting would reset the
  // timer and make the current photo linger.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const pickNext = useCallback((): GalleryPhoto | null => {
    const list = photosRef.current;
    if (list.length === 0) return null;

    const fresh = list.find((photo) => !shown.current.has(photo.id));
    if (fresh) {
      shown.current.add(fresh.id);
      return fresh;
    }

    // Everything has had its turn — start the pass again.
    shown.current = new Set([list[0]!.id]);
    return list[0]!;
  }, []);

  useEffect(() => {
    if (photos.length === 0) return;

    const timer = setInterval(() => {
      setActive((current) => {
        const next = 1 - current;
        // Flip to the layer already holding the preloaded photo, then load the
        // one after it into the layer that just went dark.
        setSlots((prev) => {
          const copy: [GalleryPhoto | null, GalleryPhoto | null] = [...prev];
          copy[current] = pickNext();
          return copy;
        });
        return next;
      });
    }, ADVANCE_MS);

    return () => clearInterval(timer);
  }, [photos.length, pickNext]);

  // Keep looking for new uploads while this is on screen.
  useEffect(() => {
    const timer = setInterval(onRefresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [onRefresh]);

  // The projector must not go to sleep, and the page should own the screen.
  useEffect(() => {
    let lock: { release: () => void } | null = null;
    void holdScreenAwake().then((held) => {
      lock = held;
    });
    void document.documentElement.requestFullscreen?.().catch(() => undefined);

    return () => {
      lock?.release();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Projekce"
      className="fixed inset-0 z-50 bg-black"
      onClick={onClose}
    >
      {slots.map((photo, index) =>
        photo ? (
          <Image
            key={`${index}-${photo.id}`}
            src={srcFor(photo.objectKey, imageGrant)}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-contain"
            style={{
              opacity: index === active ? 1 : 0,
              transition: `opacity ${FADE_MS}ms ease-in-out`,
            }}
          />
        ) : null,
      )}

      {photos.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-white/70">
          Zatím tu nejsou žádné fotky.
        </p>
      )}

      {/* The only affordance, and it fades out of the way. */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-2 text-sm text-white opacity-0 transition-opacity duration-300 hover:opacity-100 focus-visible:opacity-100"
      >
        Ukončit
      </button>
    </div>
  );
}
