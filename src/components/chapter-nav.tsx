"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { GalleryChapter } from "@/lib/gallery-chapters";

/**
 * The gallery's chapters as a row of chips under the header (docs/CHAPTERS.md).
 *
 * Sticky, so "skip to the ceremony" is one tap from anywhere in a 700-photo
 * grid; the chip of the chapter being read is highlighted and kept scrolled
 * into view, which doubles as a "you are here". Blur only under a fine
 * pointer, as with the print summary: a blurred layer over a scrolling grid is
 * what a low-end phone's GPU notices.
 *
 * When the chips overflow, each side that has more to show gets a fade and an
 * arrow — the fade says "there is more" on a phone, where a hidden scrollbar
 * otherwise gives no hint; the arrow pages the row, which a mouse without a
 * horizontal wheel has no other way to do. A vertical wheel over the bar
 * scrolls it sideways too, until it reaches an end and the page takes over.
 * The arrows are pointer conveniences only: keyboard and screen-reader users
 * Tab through the chips, and a focused chip scrolls itself into view.
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
  const [more, setMore] = useState({ before: false, after: false });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      // 1 px of slack: fractional widths leave scrollLeft a hair short of max.
      const next = { before: scroller.scrollLeft > 1, after: scroller.scrollLeft < max - 1 };
      setMore((prev) => (prev.before === next.before && prev.after === next.after ? prev : next));
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return; // already sideways
      const max = scroller.scrollWidth - scroller.clientWidth;
      const canMove = event.deltaY > 0 ? scroller.scrollLeft < max - 1 : scroller.scrollLeft > 1;
      if (!canMove) return; // at the end: let the page scroll
      event.preventDefault();
      // A wheel can report lines (Firefox) or pages instead of pixels.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientWidth
            : 1;
      scroller.scrollLeft += event.deltaY * unit;
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    // The chips too, not just the row: they change width without the row
    // doing so — most often when the brand font replaces the fallback.
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const chip of scroller.children) observer.observe(chip);
    void document.fonts?.ready.then(update);
    return () => {
      scroller.removeEventListener("scroll", update);
      scroller.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [chapters]);

  const page = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: "smooth" });
  };

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
      className="sticky top-0 z-30 flex items-center border-b bg-white/95 dark:bg-neutral-950/95 pointer-fine:bg-white/85 pointer-fine:backdrop-blur-md dark:pointer-fine:bg-neutral-950/85"
      style={{ height }}
    >
      {more.before && <ScrollArrow side="before" onClick={() => page(-1)} />}
      <div
        ref={scrollerRef}
        className="relative flex h-full min-w-0 flex-1 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 sm:px-3 [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: edgeMask(more), WebkitMaskImage: edgeMask(more) }}
      >
        {chapters.map((chapter) => {
          const current = chapter.id === currentId;
          const busy = chapter.id === jumpingTo;
          return (
            // A link, not a button: long-press / right-click copies a URL
            // that opens the gallery on this chapter (docs/CHAPTERS.md §Links).
            <a
              key={chapter.id}
              href={`#${chapter.anchor}`}
              data-chapter={chapter.id}
              aria-current={current ? "location" : undefined}
              aria-busy={busy || undefined}
              onClick={(event) => {
                // Let a modified click (new tab, copy) do what the browser does.
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                )
                  return;
                event.preventDefault();
                onJump(chapter.id);
              }}
              // It was a button, and a chip still reads as one: Space jumps
              // too, instead of scrolling the page.
              onKeyDown={(event) => {
                if (event.key !== " ") return;
                event.preventDefault();
                onJump(chapter.id);
              }}
              className={`text-body flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 whitespace-nowrap transition-colors ${
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
            </a>
          );
        })}
      </div>
      {more.after && <ScrollArrow side="after" onClick={() => page(1)} />}
    </nav>
  );
}

/**
 * A chip cut off by the edge of the row fades out instead of ending in a hard
 * line — visual only: a mask never takes clicks away from what is under it.
 */
function edgeMask(more: { before: boolean; after: boolean }): string | undefined {
  if (!more.before && !more.after) return undefined;
  const start = more.before ? "transparent 0, black 1.5rem" : "black 0";
  const end = more.after ? "black calc(100% - 1.5rem), transparent 100%" : "black 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

/**
 * Sits *beside* the row, never over it: the scrolling area narrows by the
 * arrow's width, so no chip can end up underneath a button.
 */
function ScrollArrow({ side, onClick }: { side: "before" | "after"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      onClick={onClick}
      className={`border-brand-border hover:bg-brand-tint dark:hover:bg-brand-ink/40 flex size-11 shrink-0 items-center justify-center rounded-full border bg-white dark:border-neutral-700 dark:bg-neutral-900 ${
        side === "before" ? "ml-2" : "mr-2"
      }`}
    >
      {side === "before" ? (
        <ChevronLeftIcon className="size-5" />
      ) : (
        <ChevronRightIcon className="size-5" />
      )}
    </button>
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
            className="truncate text-2xl font-semibold tracking-tight sm:text-3xl"
            // Focused only to move a screen reader here after a jump; it is
            // not a control, so no ring. Inline, because the global
            // `:focus-visible` rule sits outside Tailwind's layers and wins.
            style={{ outline: "none" }}
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
