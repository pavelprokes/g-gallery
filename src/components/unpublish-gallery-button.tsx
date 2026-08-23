"use client";

import { unpublishGallery } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

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
      <Button type="submit" variant="secondary">
        Odpublikovat
      </Button>
    </form>
  );
}
