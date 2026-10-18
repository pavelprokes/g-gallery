"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GalleryPhoto } from "@/components/gallery-view";
import type { SignedImageGrant } from "@/lib/image-signing";
import { srcFor } from "@/lib/image-src";
import { holdScreenAwake } from "@/lib/wake-lock";
import { slideshowTiming } from "@/lib/slideshow-settings";
import { projectionShot, shotKeyframes, transformFor } from "@/lib/projection-camera";

/**
 * The projection for the party (docs/GUEST-GALLERIES.md, F5): photos on the
 * venue's screen, changing by themselves, with nothing to operate.
 *
 * Deliberately without controls. This runs on a projector nobody is standing
 * next to — arrows, counters and a scrubber would only be things for a guest
 * to poke at. Escape or a click leaves; that is the whole interface.
 *
 * A photo whose faces are known moves the way the social video's camera does
 * (src/lib/projection-camera.ts): a slow push towards the people or a pull
 * out of a group. Anything else — faces never searched, a portrait on a
 * landscape screen, a group too wide to crop — stands still and whole, as
 * before; so does everything under prefers-reduced-motion.
 */
/** Pacing lives in one place — see `src/lib/slideshow-settings.ts`. */
const { advanceMs: ADVANCE_MS, fadeMs: FADE_MS } = slideshowTiming();
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
  const t = useTranslations("gallery.slideshow");
  // Each photo also takes the next turn of the camera, so push and pull
  // alternate down the run.
  const turn = useRef(2);
  const [slots, setSlots] = useState<[Slot | null, Slot | null]>([
    photos[0] ? { photo: photos[0], turn: 0 } : null,
    photos[1] ? { photo: photos[1], turn: 1 } : null,
  ]);
  const [active, setActive] = useState(0);

  // Ids already projected this pass. New photos are never in it, so they are
  // picked first — a guest's shot reaching the screen a few seconds after they
  // upload it is the entire point of doing this live.
  // Both mounted photos count as shown: the second is already queued, and
  // picking it again for the layer after it would project it twice in a row.
  const shown = useRef(new Set<string>(photos.slice(0, 2).map((photo) => photo.id)));
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
          const copy: [Slot | null, Slot | null] = [...prev];
          const photo = pickNext();
          copy[current] = photo ? { photo, turn: turn.current++ } : null;
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
      aria-label={t("ariaLabel")}
      className="fixed inset-0 z-50 bg-black"
      onClick={onClose}
    >
      {slots.map((slot, index) =>
        slot ? (
          <Slide
            key={`${index}-${slot.photo.id}`}
            photo={slot.photo}
            turn={slot.turn}
            active={index === active}
            imageGrant={imageGrant}
          />
        ) : null,
      )}

      {photos.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-white/70">
          {t("empty")}
        </p>
      )}

      {/* The only affordance, and it fades out of the way. */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-2 text-sm text-white opacity-0 transition-opacity duration-300 hover:opacity-100 focus-visible:opacity-100"
      >
        {t("exit")}
      </button>
    </div>
  );
}

interface Slot {
  photo: GalleryPhoto;
  turn: number;
}

/** How long a photo is on screen, fading in and out included — the camera's
 * move spans all of it, so it is at rest only while nobody can see it. */
const ON_SCREEN_MS = ADVANCE_MS + FADE_MS;

function Slide({
  photo,
  turn,
  active,
  imageGrant,
}: {
  photo: GalleryPhoto;
  turn: number;
  active: boolean;
  imageGrant: SignedImageGrant | null;
}) {
  // The screen as it is when the photo is queued: the projection is
  // fullscreen by then, and a photo already moving is not re-planned.
  const [screen] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const shot = useMemo(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    return still ? null : projectionShot(photo, screen, ON_SCREEN_MS / 1000, turn);
  }, [photo, screen, turn]);

  // Starts when the photo starts fading in, and is not stopped when the next
  // one does: the outgoing photo keeps moving under the crossfade.
  const camera = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!active || !shot || started.current || !camera.current?.animate) return;
    started.current = true;
    camera.current.animate(shotKeyframes(shot, screen.width), {
      duration: ON_SCREEN_MS,
      easing: "linear",
      fill: "forwards",
    });
  }, [active, shot, screen.width]);

  const fade = {
    opacity: active ? 1 : 0,
    transition: `opacity ${FADE_MS}ms ease-in-out`,
  };
  const src = srcFor(photo.objectKey, imageGrant);

  if (!shot || !photo.width || !photo.height) {
    return (
      <Image src={src} alt="" fill sizes="100vw" priority className="object-contain" style={fade} />
    );
  }
  // The photo at its own pixel size, moved and scaled by the camera; the
  // widest it is ever shown decides the variant fetched.
  const shownWidth = Math.round((photo.width * screen.width) / Math.min(shot.from.w, shot.to.w));
  return (
    <div className="absolute inset-0 overflow-hidden" style={fade}>
      <div
        ref={camera}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: photo.width,
          height: photo.height,
          ...transformFor(shot.from, screen.width),
        }}
      >
        <Image src={src} alt="" fill sizes={`${shownWidth}px`} priority className="object-cover" />
      </div>
    </div>
  );
}
