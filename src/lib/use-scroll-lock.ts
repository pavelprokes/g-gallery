"use client";

import { useEffect } from "react";

/**
 * Stops the page behind a modal from scrolling while the modal is open: the
 * lightbox, the film on its own, the download prompt, the slideshow and every
 * sheet. Without it a wheel or a swipe over the dimmed backdrop scrolled the
 * grid underneath — which mounts rows and downloads their tiles while the
 * viewer is waiting for the one photo on screen (docs/GALLERY-LOADING.md).
 *
 * `overflow: hidden` on `<html>`, not on `<body>`: the page scrolls on the
 * root element, and iOS Safari honours the root's overflow since 16 (it
 * ignored `body` and needed the old `position: fixed` trick, which loses the
 * scroll position). The rule only stops the *viewer* scrolling; a programmatic
 * scroll still works, which the lightbox relies on — it keeps the photo on
 * screen centred in the grid behind it, so closing lands there. That is also
 * why nothing restores a saved position on release: it would undo that scroll.
 *
 * Ref-counted, because modals stack (the name sheet over the lightbox): the
 * page stays locked until the last one lets go, and the inline styles in place
 * before the first lock are what the last release puts back.
 *
 * The scrollbar's width is padded back while it is hidden, so a desktop page
 * does not widen by ~15 px under the modal — the justified grid would re-lay
 * every row for it, and again on close.
 */
let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

export function acquireScrollLock(): () => void {
  const root = document.documentElement;
  if (locks === 0) {
    const scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
  }
  locks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0 && saved) {
      root.style.overflow = saved.overflow;
      root.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}

/** Holds the page still for as long as `active` is true. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    return acquireScrollLock();
  }, [active]);
}
