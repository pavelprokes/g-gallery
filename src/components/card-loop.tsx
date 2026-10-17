"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A video gallery's few muted seconds, looping over its cover on the wedding
 * page — like a Live Photo, so the card says "this moves" before anyone opens
 * it (docs/VIDEO.md). Over the poster rather than instead of it: the image
 * stays the first paint and the fallback, and the loop fades in only once it
 * is actually playing.
 *
 * Not started for a viewer who asked for reduced motion or less data; iOS in
 * Low Power Mode refuses on its own, and the poster simply stays. Loaded only
 * near the viewport and paused off it.
 */
export function CardLoop({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || saveData) return;
    // Fetched once the card is near the screen, and only decoding while on it.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (!video.src) video.src = src;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  return (
    <video
      ref={ref}
      aria-hidden
      muted
      loop
      playsInline
      preload="none"
      onPlaying={() => setPlaying(true)}
      className={`duration-toggle ease-standard pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
