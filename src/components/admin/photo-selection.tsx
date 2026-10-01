"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { deletePhotos, setGalleryCover } from "@/app/admin/actions";
import { setHighlightPin } from "@/app/admin/highlight-actions";
import { Button } from "@/components/ui/button";
import { FORMS, pluralize } from "@/lib/czech-plural";

/** What a tile's checkbox carries, so the bar can word its actions. */
interface Picked {
  id: string;
  isCover: boolean;
  /** `Photo.highlightPin`: pinned in, excluded, or left to the pick. */
  pin: boolean | null;
  inHighlights: boolean;
}

const boxesIn = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLInputElement>('input[name="photo"]'),
];

function readPicked(root: HTMLElement): Picked[] {
  return [...root.querySelectorAll<HTMLInputElement>('input[name="photo"]:checked')].map(
    (input) => ({
      id: input.value,
      isCover: input.dataset.cover === "1",
      pin: input.dataset.pin === "true" ? true : input.dataset.pin === "false" ? false : null,
      inHighlights: input.dataset.highlight === "1",
    }),
  );
}

/**
 * The admin grid's selection, Google-Photos style: a tap on a tile selects it,
 * shift-click selects a range, and the actions live in one bar at the bottom
 * instead of three buttons under each of 500 photos. The tiles are
 * server-rendered `children` with plain checkboxes; this only reads them. A
 * `<div>`, not a `<form>`: a tile can hold its own form (start a chapter).
 */
export function PhotoSelection({
  galleryId,
  pinnedCount,
  maxPinned,
  children,
}: {
  galleryId: string;
  pinnedCount: number;
  maxPinned: number;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The photo, not its position: a refresh (an upload finishing) reorders the grid.
  const lastClicked = useRef<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [pending, startTransition] = useTransition();

  const sync = () => rootRef.current && setPicked(readPicked(rootRef.current));
  const clear = () => {
    for (const box of rootRef.current ? boxesIn(rootRef.current) : []) box.checked = false;
    lastClicked.current = null;
    setPicked([]);
  };

  // New server-rendered tiles (a refresh) may carry new cover/pin state, or
  // drop a selected photo: read the checkboxes again.
  useEffect(() => {
    if (rootRef.current) setPicked(readPicked(rootRef.current));
  }, [children]);

  useEffect(() => {
    if (picked.length === 0) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && clear();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked.length]);

  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      clear();
    });

  const single = picked.length === 1 ? picked[0]! : null;
  const pinFull =
    !!single && single.pin === null && !single.inHighlights && pinnedCount >= maxPinned;

  return (
    <div
      ref={rootRef}
      data-selecting={picked.length > 0 ? "" : undefined}
      onChange={sync}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const input =
          target instanceof HTMLInputElement && target.name === "photo"
            ? target
            : target.closest("label")?.querySelector<HTMLInputElement>('input[name="photo"]');
        if (!input) return;
        // A shift-click on the tile rather than the box: Firefox does not pass a
        // modified click from a label to its checkbox, so toggle it here.
        if (event.shiftKey && target !== input) {
          event.preventDefault();
          input.checked = !input.checked;
        }
        // Shift-click checks everything between the last click and this one.
        const boxes = boxesIn(rootRef.current!);
        const from = boxes.findIndex((box) => box.value === lastClicked.current);
        if (event.shiftKey && from >= 0) {
          const [start, end] = [from, boxes.indexOf(input)].sort((a, b) => a - b);
          for (const box of boxes.slice(start, end! + 1)) box.checked = input.checked;
        }
        if (event.shiftKey) sync();
        lastClicked.current = input.value;
      }}
      // No text selection on a shift-click; `pb-28` keeps the last row above the bar.
      className={`select-none ${picked.length > 0 ? "pb-28" : ""}`}
    >
      {/* Inert while an action runs: a selection made now would be cleared
          by it the moment it finishes. */}
      <div inert={pending}>{children}</div>

      <p className="sr-only" aria-live="polite">
        {picked.length > 0 ? `Vybráno: ${pluralize(picked.length, FORMS.photo)}` : ""}
      </p>

      {picked.length > 0 && (
        <div
          role="toolbar"
          aria-label="Akce s vybranými fotkami"
          className="border-admin-border fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
            <p className="mr-auto text-sm font-semibold tabular-nums">
              Vybráno: {pluralize(picked.length, FORMS.photo)}
            </p>
            {single && (
              <Button
                variant="secondary"
                size="lg"
                disabled={pending}
                onClick={() =>
                  run(() => setGalleryCover(galleryId, single.isCover ? null : single.id))
                }
              >
                {single.isCover ? "Zrušit titulní" : "Nastavit jako titulní"}
              </Button>
            )}
            {single &&
              (pinFull ? (
                // Said, not a greyed-out button: a tooltip never shows on a phone.
                <p className="text-admin-muted text-xs">
                  Výběr je plný ({maxPinned} připnutých) — nejdřív některou odepni.
                </p>
              ) : (
                // docs/HIGHLIGHTS.md — pinned always in, excluded never, else the pick decides.
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      setHighlightPin(
                        single.id,
                        single.pin !== null ? null : single.inHighlights ? false : true,
                      ),
                    )
                  }
                >
                  {single.pin === true
                    ? "Odepnout z výběru"
                    : single.pin === false
                      ? "Vrátit do návrhu výběru"
                      : single.inHighlights
                        ? "Vyřadit z výběru"
                        : "Připnout do výběru"}
                </Button>
              ))}
            <Button
              variant="destructive"
              size="lg"
              disabled={pending}
              onClick={() => {
                const what = picked.length === 1 ? "fotku" : pluralize(picked.length, FORMS.photo);
                if (!confirm(`Smazat ${what}? Tohle už nejde vzít zpět.`)) return;
                run(() => deletePhotos(picked.map((photo) => photo.id)));
              }}
            >
              Smazat
            </Button>
            <Button variant="ghost" size="lg" disabled={pending} onClick={clear}>
              Zrušit výběr
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
