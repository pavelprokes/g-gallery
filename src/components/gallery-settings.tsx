"use client";

import { useState } from "react";
import { updateGallery } from "@/app/admin/actions";

/**
 * Renaming a gallery, or fixing its date or description. Behind a button, like
 * {@link EventSettings} — it is the rare action on a page whose job is showing
 * photos and links.
 *
 * Neither the share links nor the wedding-page card change address when the
 * title does: both slugs are frozen at creation (see `updateGallery`).
 */
export function GallerySettings({
  galleryId,
  title,
  eventDate,
  description,
}: {
  galleryId: string;
  title: string;
  eventDate: string | null;
  description: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-3 py-1.5 text-sm"
      >
        Přejmenovat
      </button>
    );
  }

  return (
    <form
      action={async (formData: FormData) => {
        await updateGallery(galleryId, formData);
        setOpen(false);
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Název
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={title}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Datum akce
        <input
          name="eventDate"
          type="date"
          defaultValue={eventDate ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Popis
        <input
          name="description"
          maxLength={2000}
          defaultValue={description ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Uložit
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-1.5 text-sm underline"
      >
        Zrušit
      </button>
      <p className="w-full text-xs text-neutral-500">
        Adresy odkazů se nezmění — jsou zamrazené od vytvoření, aby už rozeslané fungovaly dál.
      </p>
    </form>
  );
}
