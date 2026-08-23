"use client";

import { useState } from "react";
import { createEvent } from "@/app/admin/actions";

/**
 * Creating a wedding page reveals its URL exactly once — only the token's
 * SHA-256 is stored (invariant 5), so it cannot be shown again afterwards.
 * Same contract as {@link ShareLinkPanel}, and the same warning, because
 * losing this one means the whole page has to be recreated.
 */
export function EventCreatePanel() {
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    try {
      const { token, slug } = await createEvent(formData);
      setFreshUrl(`${window.location.origin}/s/${token}/${slug}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Nová svatba</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Jedna adresa, na kterou vede QR kód. Galerie se na ni přidávají později — a odkaz se tím
        nemění.
      </p>

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
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
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Vytvořit
        </button>
      </form>

      {freshUrl && (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">Adresu zkopíruj teď — už se nikdy nezobrazí.</p>
          <code className="mt-1 block text-xs break-all">{freshUrl}</code>
          <button
            type="button"
            className="mt-2 rounded border px-2 py-1 text-xs"
            onClick={() => void navigator.clipboard.writeText(freshUrl)}
          >
            Kopírovat
          </button>
        </div>
      )}
    </section>
  );
}
