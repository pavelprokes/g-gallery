"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moveGalleryPhoto } from "@/app/admin/manual-order-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { SortableList } from "@/components/admin/sortable-list";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { placeholderStyle } from "@/lib/placeholder";

export interface BoardPhoto {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  placeholder: string | null;
  isVideo: boolean;
}

/** A pause in dragging this long renders the page again, once, for what follows the order. */
const REFRESH_AFTER_MS = 1500;

/**
 * The gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order): every
 * photo in the order guests see, dragged into place. Each drop is saved at
 * once — one row, the moved photo — and shown before the server answers; a
 * failed save puts the photo back and says so. The whole page is not rendered
 * for each drop: it is for a pause, so the chapter marks and panels catch up.
 */
export function ManualOrderBoard({
  galleryId,
  doneHref,
  photos,
  chapterStarts,
}: {
  galleryId: string;
  /** Where "Hotovo" goes, once nothing is left to save. */
  doneHref: string;
  photos: BoardPhoto[];
  /** Chapter titles by the photo each begins at. */
  chapterStarts: Record<string, string[]>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(photos);
  const [seen, setSeen] = useState(photos);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const moved = useRef(false);

  // A refresh (that pause, an upload finishing) brings new props. The order on
  // screen stays, it may be ahead of them; a photo new to it goes last, as new
  // photos do, and one gone goes.
  if (seen !== photos) {
    setSeen(photos);
    const fresh = new Map(photos.map((photo) => [photo.id, photo]));
    const kept = items.flatMap((photo) => {
      const current = fresh.get(photo.id);
      return current ? [current] : [];
    });
    const known = new Set(kept.map((photo) => photo.id));
    setItems([...kept, ...photos.filter((photo) => !known.has(photo.id))]);
  }

  useEffect(() => {
    if (saving > 0 || !moved.current) return;
    const timer = setTimeout(() => {
      moved.current = false;
      router.refresh();
    }, REFRESH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [saving, router]);

  // A save on its way would be lost with the page.
  useEffect(() => {
    if (saving === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  const reorder = async (
    next: BoardPhoto[],
    { item, to }: { item: BoardPhoto; from: number; to: number },
  ) => {
    const previous = items;
    setItems(next);
    setError(null);
    moved.current = true;
    setSaving((n) => n + 1);
    try {
      await moveGalleryPhoto(galleryId, item.id, next[to - 1]?.id ?? null);
    } catch {
      setItems(previous);
      setError(`${item.fileName} se nepodařilo přesunout. Zkus to znovu.`);
    } finally {
      setSaving((n) => n - 1);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-admin-muted text-caption min-w-0 flex-1 basis-64 dark:text-neutral-400"
          role="status"
        >
          {saving > 0
            ? "Ukládám…"
            : "Přetáhni fotku na nové místo (na telefonu za ⠿) — hosté uvidí nové pořadí hned. Šipky na klávesnici posouvají o jedno místo, Home a End na začátek a konec."}
        </p>
        {/* A full load: it clears the router's cached copies of the old order. */}
        <Button disabled={saving > 0} onClick={() => window.location.assign(doneHref)}>
          Hotovo
        </Button>
      </div>
      {error && (
        <Alert tone="danger" compact>
          {error}
        </Alert>
      )}
      <SortableList
        items={items}
        label="Pořadí fotek v galerii"
        itemName={(photo, index) => `${photo.fileName} (${index + 1}.)`}
        onReorder={(next, move) => void reorder(next, move)}
        className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8"
        itemClassName="[contain-intrinsic-size:auto_160px] [content-visibility:auto]"
        renderItem={(photo, index) => (
          <figure className="space-y-1">
            <div
              className="bg-brand-tint relative aspect-square overflow-hidden rounded"
              style={
                photo.placeholder
                  ? { backgroundColor: placeholderStyle(photo.placeholder) }
                  : undefined
              }
            >
              <AdminPhotoImage
                objectKey={photo.objectKey}
                thumbObjectKey={photo.thumbObjectKey}
                alt={photo.fileName}
                sizes="(max-width: 640px) 33vw, 160px"
              />
              <span className="text-caption absolute right-1 bottom-1 rounded-full bg-black/60 px-2 py-0.5 font-semibold text-white tabular-nums">
                {photo.isVideo ? "▶ " : ""}
                {index + 1}
              </span>
            </div>
            <figcaption className="text-caption truncate text-neutral-500 dark:text-neutral-400">
              {chapterStarts[photo.id]?.map((title) => (
                <span key={title} className="text-brand-primary-dark block truncate font-semibold">
                  ▸ {title}
                </span>
              ))}
              {photo.fileName}
            </figcaption>
          </figure>
        )}
      />
    </div>
  );
}
