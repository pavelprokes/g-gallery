"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, type RefObject } from "react";
import type { GalleryChapter } from "@/lib/gallery-chapters";

/**
 * The gallery's chapters as a row of chips under the header (docs/CHAPTERS.md).
 *
 * Sticky, so "skip to the ceremony" is one tap from anywhere in a 700-photo
 * grid; the chip of the chapter being read is highlighted and kept scrolled
 * into view, which doubles as a "you are here". Blur only under a fine
 * pointer, as with the print summary: a blurred layer over a scrolling grid is
 * what a low-end phone's GPU notices.
 */
export function ChapterBar({
  chapters,
  currentId,
  jumpingTo,
  onJump,
  height,
}: {
  chapters: GalleryChapter[];
  currentId: string | null;
  jumpingTo: string | null;
  onJump: (chapterId: string) => void;
  height: number;
}) {
  const t = useTranslations("gallery");
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Keep the current chip visible as the grid scrolls past chapters. Only the
  // bar's own horizontal scroll moves — never the page.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !currentId) return;
    const chip = scroller.querySelector<HTMLElement>(`[data-chapter="${CSS.escape(currentId)}"]`);
    if (!chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16;
    if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollTo({ left, behavior: "smooth" });
    }
  }, [currentId]);

  return (
    <nav
      aria-label={t("chaptersNavLabel")}
      className="sticky top-0 z-30 border-b bg-white/95 dark:bg-neutral-950/95 pointer-fine:bg-white/85 pointer-fine:backdrop-blur-md dark:pointer-fine:bg-neutral-950/85"
      style={{ height }}
    >
      <div
        ref={scrollerRef}
        className="relative flex h-full snap-x [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 sm:px-3 [&::-webkit-scrollbar]:hidden"
      >
        {chapters.map((chapter) => {
          const current = chapter.id === currentId;
          const busy = chapter.id === jumpingTo;
          return (
            <button
              key={chapter.id}
              type="button"
              data-chapter={chapter.id}
              aria-current={current ? "location" : undefined}
              aria-busy={busy || undefined}
              onClick={() => onJump(chapter.id)}
              className={`text-body flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border px-4 whitespace-nowrap transition-colors ${
                current
                  ? "border-brand-ink bg-brand-ink dark:border-brand-tint dark:bg-brand-tint dark:text-brand-ink text-white"
                  : "border-brand-border hover:bg-brand-tint dark:hover:bg-brand-ink/40 dark:border-neutral-700"
              } ${busy ? "cursor-progress" : ""}`}
            >
              {busy && (
                <span
                  aria-hidden
                  className="motion-loop size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {chapter.title}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * A chapter's header: a full-width row of its own in the virtualized grid, so
 * the chapter's first photo always starts a fresh row beneath it.
 *
 * The heading takes focus after a jump (`focusRef`), so a screen reader lands
 * on "Obřad" rather than being left on the chip that was pressed.
 */
export function ChapterHeaderRow({
  chapter,
  ordinal,
  height,
  offset,
  focusRef,
}: {
  chapter: GalleryChapter;
  ordinal: number;
  height: number;
  offset: number;
  focusRef: RefObject<string | null>;
}) {
  const t = useTranslations("gallery");

  return (
    <li
      className="absolute top-0 left-0 flex w-full items-end px-4 pb-3 sm:px-3"
      style={{ height, transform: `translateY(${offset}px)` }}
    >
      <div className="border-brand-border dark:border-brand-ink flex w-full min-w-0 items-end justify-between gap-4 border-b pb-2">
        <div className="min-w-0">
          <p className="text-caption text-brand-primary dark:text-brand-border font-semibold tracking-[0.14em] uppercase">
            {t("chapterEyebrow", { number: ordinal })}
          </p>
          <h2
            tabIndex={-1}
            ref={(el) => {
              if (el && focusRef.current === chapter.id) {
                el.focus({ preventScroll: true });
                focusRef.current = null;
              }
            }}
            className="truncate text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
          >
            {chapter.title}
          </h2>
        </div>
        <p className="text-body text-brand-ink/60 dark:text-brand-tint/60 shrink-0 pb-0.5">
          {t("photoCount", { count: chapter.count })}
        </p>
      </div>
    </li>
  );
}
