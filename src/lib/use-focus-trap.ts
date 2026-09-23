"use client";

import { type RefObject, useEffect } from "react";

/**
 * Traps Tab/Shift+Tab inside a modal container and restores focus to
 * whatever was focused before it opened. Shared by the lightbox, the download
 * prompt and the name sheet, which can each appear stacked over the grid.
 *
 * `initialFocus` names the control that should receive focus on open. Without
 * it the first focusable element wins, which in the lightbox is whichever nav
 * button happens to be enabled: on photo 1 "Předchozí" is disabled and focus
 * fell through to "Další", while anywhere else it landed on "Předchozí" —
 * so the same action put the keyboard in two different places depending on
 * which photo was opened. A modal's initial focus has to be predictable.
 */
export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
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
      ).filter(
        // `inert` is how the lightbox hides its chrome; its subtree must not be
        // a Tab stop or a focus target, and `offsetParent` alone does not
        // exclude it (nor does it exclude an `opacity-0` element).
        (el) => el.offsetParent !== null && !el.closest("[inert]"),
      );

    (initialFocusRef?.current ?? getFocusable()[0] ?? container).focus();

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
      // The opener may have been replaced while the modal was open; focusing a
      // detached node is a silent no-op, so leave it to the caller then.
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
