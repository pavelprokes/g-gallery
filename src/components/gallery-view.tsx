"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getOptOutServerSnapshot,
  getOptOutSnapshot,
  getViewerId,
  optOut,
  subscribeOptOut,
} from "@/lib/viewer-id";
import { originalUrl } from "@/lib/photo-url";

export interface GalleryPhoto {
  id: string;
  objectKey: string;
  fileName: string;
  width: number | null;
  height: number | null;
}

/** Heartbeat cadence while the tab is visible; also keeps Supabase awake. */
const HEARTBEAT_MS = 5 * 60 * 1000;

export function GalleryView({
  token,
  title,
  eventDate,
  photos,
  allowDownload,
}: {
  token: string;
  title: string;
  eventDate: string | null;
  photos: GalleryPhoto[];
  allowDownload: boolean;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {eventDate && <p className="text-sm text-neutral-500">{eventDate}</p>}
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => openPhoto(index)}
              className="relative block aspect-square w-full overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900"
              aria-label={`Otevřít ${photo.fileName}`}
            >
              <Image
                src={photo.objectKey}
                alt={photo.fileName}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                className="object-cover transition-transform duration-200 hover:scale-105"
              />
            </button>
          </li>
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
          <div className="relative h-full w-full" onClick={(event) => event.stopPropagation()}>
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
            onClick={(e) => {
              e.stopPropagation();
              move(-1);
            }}
            className="absolute left-4 rounded-full bg-white/10 px-4 py-3 text-white"
            aria-label="Předchozí"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
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
          {allowDownload && (
            <a
              href={originalUrl(active.objectKey)}
              download={active.fileName}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-4 rounded-full bg-white/10 px-4 py-2 text-sm text-white"
            >
              Stáhnout originál
            </a>
          )}
        </div>
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
