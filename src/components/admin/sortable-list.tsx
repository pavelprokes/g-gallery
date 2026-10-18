"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { moveItem, slotAt } from "@/lib/reorder";

/**
 * Drag-and-drop reordering for the admin — a strip of slides, a grid of
 * photos. Pointer events, so the same code serves a mouse, a pen and a finger:
 *
 * - a mouse or a pen drags the whole tile (after a few pixels, so a click
 *   still clicks);
 * - a finger drags only the ⠿ handle — anywhere else on the tile scrolls the
 *   page as usual;
 * - the keyboard moves the focused handle with the arrow keys, Home and End.
 *
 * The list shows the new order while dragging and reports it once, on drop.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  itemName,
  label,
  className = "",
  itemClassName = "",
}: {
  items: readonly T[];
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** "Fotka 3" — for the handle's label and the announcement. */
  itemName: (item: T, index: number) => string;
  label: string;
  className?: string;
  itemClassName?: string;
}) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const pending = useRef<{
    from: number;
    x: number;
    y: number;
    pointerId: number;
    rects: DOMRect[];
  } | null>(null);

  const shown = drag ? moveItem(items, drag.from, drag.over) : items;

  const commit = (from: number, to: number) => {
    if (from === to) return;
    const next = moveItem(items, from, to);
    onReorder(next);
    setAnnouncement(`${itemName(items[from]!, from)} je teď ${to + 1}. z ${items.length}.`);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, index: number, fromHandle: boolean) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch" && !fromHandle) return;
    // A button or link inside the tile keeps its own click.
    const target = event.target as Element;
    if (!fromHandle && target.closest("button, a, input, select, textarea")) return;
    const rects = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [],
      (li) => li.getBoundingClientRect(),
    );
    pending.current = {
      from: index,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      rects,
    };
    if (fromHandle) event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLOListElement>) => {
    const start = pending.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (!drag) {
      // A click is not a drag: wait for the pointer to travel a little.
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      listRef.current?.setPointerCapture(event.pointerId);
    }
    const over = slotAt(event.clientX, event.clientY, start.rects);
    setDrag({ from: start.from, over: over === -1 ? start.from : over });
  };

  const end = (event: PointerEvent<HTMLOListElement>, drop: boolean) => {
    const start = pending.current;
    if (!start || start.pointerId !== event.pointerId) return;
    pending.current = null;
    if (drag && drop) commit(drag.from, drag.over);
    setDrag(null);
  };

  const onHandleKey = (event: KeyboardEvent, index: number) => {
    const to =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? index - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? index + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (to === null || to < 0 || to >= items.length) return;
    event.preventDefault();
    commit(index, to);
    // Keep the focus on the item that moved, at its new place.
    requestAnimationFrame(() =>
      listRef.current?.querySelectorAll<HTMLElement>("[data-sort-handle]")[to]?.focus(),
    );
  };

  return (
    <>
      <ol
        ref={listRef}
        aria-label={label}
        className={className}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => end(e, true)}
        onPointerCancel={(e) => end(e, false)}
      >
        {shown.map((item, index) => {
          const dragged = drag !== null && index === drag.over;
          return (
            <li
              key={item.id}
              className={`relative ${dragged ? "z-10 scale-105 opacity-80 shadow-lg" : ""} transition-transform select-none ${itemClassName}`}
              onPointerDown={(e) => onPointerDown(e, index, false)}
              // An <img> starts the browser's own drag on mouse-down, which
              // cancels the pointer events this list is driven by.
              onDragStart={(e) => e.preventDefault()}
            >
              {renderItem(item, index)}
              <button
                type="button"
                data-sort-handle
                aria-label={`Přesunout: ${itemName(item, index)} (šipkami)`}
                className="absolute top-1 left-1 grid size-8 cursor-grab touch-none place-items-center rounded-full bg-black/55 text-sm text-white active:cursor-grabbing pointer-coarse:size-11"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPointerDown(e, index, true);
                }}
                onKeyDown={(e) => onHandleKey(e, index)}
              >
                <span aria-hidden>⠿</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
