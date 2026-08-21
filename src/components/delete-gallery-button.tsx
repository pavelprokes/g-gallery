"use client";

import { trashGallery } from "@/app/admin/actions";

/**
 * Moves a gallery to trash. Reversible (30-day recovery window), but still a
 * real destructive action from the photographer's point of view, so it asks
 * before firing — a plain `confirm()` rather than a bespoke dialog, matching
 * this codebase's minimal, dependency-free UI elsewhere.
 */
export function DeleteGalleryButton({ galleryId }: { galleryId: string }) {
  return (
    <form
      action={trashGallery.bind(null, galleryId)}
      onSubmit={(event) => {
        if (!confirm("Přesunout galerii do koše? Půjde obnovit ještě 30 dní.")) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="rounded border px-3 py-1.5 text-sm text-red-600">
        Smazat
      </button>
    </form>
  );
}
