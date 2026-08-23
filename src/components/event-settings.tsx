"use client";

import { useState } from "react";
import { updateEvent } from "@/app/admin/actions";

/**
 * Renaming a wedding, or fixing its date or venue. Behind a button because it
 * is the rare action on a page whose job is mostly to show links.
 *
 * The address does not change with the name — the slug is frozen at creation
 * (see `updateEvent`), so anything already printed keeps working.
 */
export function EventSettings({
  eventId,
  title,
  eventDate,
  venue,
}: {
  eventId: string;
  title: string;
  eventDate: string | null;
  venue: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border px-3 py-1.5 text-sm"
      >
        Upravit
      </button>
    );
  }

  return (
    <form
      action={async (formData: FormData) => {
        await updateEvent(eventId, formData);
        setOpen(false);
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Pár
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={title}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Datum
        <input
          name="eventDate"
          type="date"
          defaultValue={eventDate ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Místo
        <input
          name="venue"
          maxLength={200}
          defaultValue={venue ?? ""}
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
        Adresa svatby se nezmění — je zamrazená od založení, aby vytištěný QR kód dál fungoval.
      </p>
    </form>
  );
}
