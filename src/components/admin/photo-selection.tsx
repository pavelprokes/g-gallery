"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { copyPhotosToWebGallery, deletePhotos, setGalleryCover } from "@/app/admin/actions";
import { setHighlightPin } from "@/app/admin/highlight-actions";
import { Button } from "@/components/ui/button";
import { FORMS, pluralize } from "@/lib/czech-plural";

/** One Server Action per this many photos, so the bar can count them as they go. */
const COPY_CHUNK = 4;

interface CopyResult {
  text: string;
  galleryId: string;
  galleryTitle: string;
}

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
  webGalleries = [],
  children,
}: {
  galleryId: string;
  pinnedCount: number;
  maxPinned: number;
  /** Where the selection can be copied (docs/WEB-GALLERIES.md). */
  webGalleries?: { id: string; title: string }[];
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The photo, not its position: a refresh (an upload finishing) reorders the grid.
  const lastClicked = useRef<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [pending, startTransition] = useTransition();
  const [webTarget, setWebTarget] = useState("");
  const [copying, setCopying] = useState<{ done: number; total: number } | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);

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

  // A failure keeps the selection: copying again is one click, and what has
  // landed is skipped by its file identity (copyPhotosToWebGalleryFor).
  const copyToWeb = () => {
    const ids = picked.map((photo) => photo.id);
    const galleryId = webTarget;
    const galleryTitle = webGalleries.find((gallery) => gallery.id === galleryId)?.title ?? "";
    setCopyResult(null);
    setCopying({ done: 0, total: ids.length });
    startTransition(async () => {
      let copied = 0;
      let skipped = 0;
      let failed = 0;
      let stopped = false;
      for (let start = 0; start < ids.length && !stopped; start += COPY_CHUNK) {
        try {
          const chunk = ids.slice(start, start + COPY_CHUNK);
          const result = await copyPhotosToWebGallery(galleryId, chunk);
          copied += result.copied;
          skipped += result.skipped;
          failed += result.failed;
          setCopying({ done: start + chunk.length, total: ids.length });
        } catch {
          stopped = true;
        }
      }
      const summary =
        `Zkopírováno na web: ${pluralize(copied, FORMS.photo)}` +
        (skipped > 0 ? `, přeskočeno: ${pluralize(skipped, FORMS.photo)}` : "") +
        (failed > 0 ? `, nepovedlo se: ${pluralize(failed, FORMS.photo)}` : "");
      setCopyResult({
        text:
          stopped || failed > 0
            ? `${summary}. ${stopped ? "Kopírování se přerušilo. " : ""}Zkus to znovu, hotové fotky se přeskočí.`
            : summary,
        galleryId,
        galleryTitle,
      });
      setCopying(null);
      if (!stopped && failed === 0) clear();
    });
  };

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
      // No text selection on a shift-click; the padding keeps the last row above the
      // bar, which wraps to five lines on a phone with a web gallery to copy to.
      className={`select-none ${picked.length > 0 || copyResult ? "pb-72 sm:pb-28" : ""}`}
    >
      {/* Inert while an action runs: a selection made now would be cleared
          by it the moment it finishes. */}
      <div inert={pending}>{children}</div>

      <p role="status" className="sr-only">
        {copying
          ? `Kopíruji na web: ${pluralize(copying.total, FORMS.photo)}`
          : (copyResult?.text ??
            (picked.length > 0 ? `Vybráno: ${pluralize(picked.length, FORMS.photo)}` : ""))}
      </p>

      {(picked.length > 0 || copyResult) && (
        <div className="border-admin-border fixed inset-x-0 bottom-0 z-30 border-t bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-950">
          {copying && (
            <progress
              aria-label="Průběh kopírování na web"
              max={copying.total}
              value={copying.done}
              className="bg-admin-accent-soft [&::-moz-progress-bar]:bg-brand-primary [&::-webkit-progress-bar]:bg-admin-accent-soft [&::-webkit-progress-value]:bg-brand-primary block h-1 w-full appearance-none"
            />
          )}
          {copyResult && (
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <p className="mr-auto font-semibold">{copyResult.text}</p>
              <Link href={`/admin/g/${copyResult.galleryId}`} className="font-semibold underline">
                Otevřít {copyResult.galleryTitle}
              </Link>
              <Button variant="ghost" size="sm" onClick={() => setCopyResult(null)}>
                Zavřít
              </Button>
            </div>
          )}
          {picked.length > 0 && (
            <div
              role="toolbar"
              aria-label="Akce s vybranými fotkami"
              className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3"
            >
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
              {webGalleries.length > 0 && (
                <>
                  <select
                    aria-label="Webová galerie"
                    className="border-admin-border h-10 max-w-56 rounded border bg-white px-2 text-sm"
                    value={webTarget}
                    onChange={(event) => setWebTarget(event.target.value)}
                  >
                    <option value="">Webová galerie…</option>
                    {webGalleries.map((gallery) => (
                      <option key={gallery.id} value={gallery.id}>
                        {gallery.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="lg"
                    disabled={pending || !webTarget}
                    // Working, not unavailable: greyed out, this is what looked dead.
                    className={copying ? "disabled:opacity-100!" : undefined}
                    onClick={copyToWeb}
                  >
                    {copying ? (
                      <>
                        <span
                          aria-hidden
                          className="motion-loop border-admin-border border-t-brand-primary size-4 animate-spin rounded-full border-2"
                        />
                        <span className="tabular-nums">
                          Kopíruji {copying.done} / {copying.total}
                        </span>
                      </>
                    ) : (
                      "Kopírovat na web"
                    )}
                  </Button>
                </>
              )}
              <Button
                variant="destructive"
                size="lg"
                disabled={pending}
                onClick={() => {
                  const what =
                    picked.length === 1 ? "fotku" : pluralize(picked.length, FORMS.photo);
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
          )}
        </div>
      )}
    </div>
  );
}
