"use client";

import { unpublishGallery } from "@/app/admin/actions";

/**
 * Takes a gallery back to DRAFT. Every share surface refuses a gallery that is
 * not published, so this cuts off every link to it at once — including a
 * wedding-page card. That is what it is for, and why it asks.
 */
export function UnpublishGalleryButton({ galleryId }: { galleryId: string }) {
  return (
    <form
      action={unpublishGallery.bind(null, galleryId)}
      onSubmit={(event) => {
        if (
          !confirm(
            "Vrátit galerii do konceptu? Všechny odkazy na ni přestanou fungovat, včetně karty na stránce svatby.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="rounded border px-3 py-1.5 text-sm">
        Odpublikovat
      </button>
    </form>
  );
}
