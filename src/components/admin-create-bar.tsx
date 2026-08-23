"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createEvent } from "@/app/admin/actions";

/**
 * The two things this admin creates, behind two buttons.
 *
 * They used to be two forms permanently open above the list, which made the
 * page look like a data-entry screen when its actual job is to show what
 * exists and where it points.
 *
 * Neither reveals a link any more: creating either one lands on its detail
 * page, where the address is shown with a copy control and stays shown
 * (src/lib/token-cipher.ts). Nothing has to be captured in the moment.
 */
export function AdminCreateBar({
  createGalleryAction,
}: {
  createGalleryAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState<"wedding" | "gallery" | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function submitWedding(formData: FormData) {
    setPending(true);
    try {
      const { id } = await createEvent(formData);
      router.push(`/admin/e/${id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === "wedding" ? null : "wedding")}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          + Nová svatba
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "gallery" ? null : "gallery")}
          className="rounded border px-3 py-1.5 text-sm"
        >
          + Samostatná galerie
        </button>
      </div>

      {open === "wedding" && (
        <form action={submitWedding} className="mt-4 rounded-lg border p-4">
          <p className="mb-3 text-xs text-neutral-500">
            Jedna adresa, na kterou vede QR kód. Galerie se na ni přidávají později — a adresa se
            tím nemění.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Pár
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Pavel a Patricie"
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Datum
              <input name="eventDate" type="date" className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Místo
              <input
                name="venue"
                maxLength={200}
                placeholder="Statek Benice"
                className="rounded border px-2 py-1"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {pending ? "Zakládám…" : "Vytvořit"}
            </button>
          </div>
        </form>
      )}

      {open === "gallery" && (
        <form action={createGalleryAction} className="mt-4 rounded-lg border p-4">
          <p className="mb-3 text-xs text-neutral-500">
            Galerie mimo svatbu — klientská zakázka, která rozcestník nepotřebuje. Do svatby jde
            připojit i později.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Název
              <input name="title" required maxLength={200} className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Datum akce
              <input name="eventDate" type="date" className="rounded border px-2 py-1" />
            </label>
            <button
              type="submit"
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Vytvořit
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
