"use client";

import { useState } from "react";
import { createGalleryForEvent } from "@/app/admin/actions";

/**
 * Adding a gallery to a wedding, the two ways it actually happens: a brand new
 * one, or one that already exists on its own.
 *
 * Both are behind buttons rather than always-open forms — the page is mostly
 * read (which galleries are listed, what their links are), and two permanently
 * expanded forms at the bottom made it look like the page's job was data entry.
 */
export function NewGalleryInEvent({
  eventId,
  unattached,
  attach,
}: {
  eventId: string;
  unattached: { id: string; title: string }[];
  attach: (eventId: string, galleryId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<"new" | "existing" | null>(null);

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === "new" ? null : "new")}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          + Nová galerie
        </button>
        <button
          type="button"
          disabled={unattached.length === 0}
          onClick={() => setOpen(open === "existing" ? null : "existing")}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          title={unattached.length === 0 ? "Všechny galerie už někam patří" : undefined}
        >
          Přidat existující ({unattached.length})
        </button>
      </div>

      {open === "new" && (
        <form
          action={createGalleryForEvent.bind(null, eventId)}
          className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            Název
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Od hostů"
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Datum akce
            <input name="eventDate" type="date" className="rounded border px-2 py-1" />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <input name="allowUpload" type="checkbox" value="1" className="size-4" />
            Hosté sem smí nahrávat
          </label>
          <button
            type="submit"
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Vytvořit a připojit
          </button>
          <p className="w-full text-xs text-neutral-500">
            Vytvoří galerii, publikuje ji, založí odkaz a nastaví ho jako cestu z karty. Na
            rozcestníku se ale neobjeví, dokud ji sám nezobrazíš.
          </p>
        </form>
      )}

      {open === "existing" && unattached.length > 0 && (
        <form
          action={async (formData: FormData) => {
            await attach(eventId, String(formData.get("galleryId")));
            setOpen(null);
          }}
          className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4"
        >
          <select name="galleryId" className="rounded border px-2 py-1 text-sm">
            {unattached.map((gallery) => (
              <option key={gallery.id} value={gallery.id}>
                {gallery.title}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">
            Připojit
          </button>
          <p className="w-full text-xs text-neutral-500">
            Nezapomeň pak vybrat „Karta vede přes“ — bez toho se karta hostům nezobrazí.
          </p>
        </form>
      )}
    </section>
  );
}
