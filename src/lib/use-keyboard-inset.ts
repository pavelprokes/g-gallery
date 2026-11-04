"use client";

import { useEffect, useState } from "react";

/** How many pixels of the layout viewport the on-screen keyboard covers. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      // A pinch-zoomed page shrinks the visual viewport too. Only an
      // unzoomed shrink is the keyboard.
      if (viewport.scale > 1.01) return setInset(0);
      setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
