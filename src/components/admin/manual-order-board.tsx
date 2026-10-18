"use client";

import { useState } from "react";
import { moveGalleryPhoto } from "@/app/admin/manual-order-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { SortableList } from "@/components/admin/sortable-list";
import { Alert } from "@/components/ui/alert";
import { placeholderStyle } from "@/lib/placeholder";

export interface BoardPhoto {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  placeholder: string | null;
  isVideo: boolean;
}

/**
 * The gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order): every
 * photo in the order guests see, dragged into place. Each drop is saved at
 * once — one row, the moved photo — and shown before the server answers; a
 * failed save puts the photo back and says so.
 */
export function ManualOrderBoard({
  galleryId,
  photos,
  chapterStarts,
}: {
  galleryId: string;
  photos: BoardPhoto[];
  /** Chapter titles by the photo each begins at. */
  chapterStarts: Record<string, string[]>;
}) {
  const [items, setItems] = useState(photos);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reorder = async (
    next: BoardPhoto[],
    { item, to }: { item: BoardPhoto; from: number; to: number },
  ) => {
    const previous = items;
    setItems(next);
    setError(null);
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
      <p className="text-admin-muted text-caption dark:text-neutral-400" role="status">
        {saving > 0
          ? "Ukládám…"
          : "Přetáhni fotku na nové místo (na telefonu za ⠿) — hosté uvidí nové pořadí hned. Šipky na klávesnici posouvají o jedno místo, Home a End na začátek a konec."}
      </p>
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
