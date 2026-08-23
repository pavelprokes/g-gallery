"use client";

import { deletePhoto } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

/**
 * Removes one photo for good. The couple's veto over a guest upload runs
 * through here (docs/GUEST-GALLERIES.md §7), so it has to be immediate — but
 * it is also irreversible, unlike moving a whole gallery to the trash, so it
 * asks first. Plain `confirm()`, matching {@link DeleteGalleryButton} and the
 * rest of this codebase's dependency-free UI.
 */
export function DeletePhotoButton({ photoId }: { photoId: string }) {
  return (
    <form
      action={deletePhoto.bind(null, photoId)}
      onSubmit={(event) => {
        if (!confirm("Smazat fotku? Tohle už nejde vzít zpět.")) event.preventDefault();
      }}
    >
      <Button type="submit" variant="destructive" size="sm">
        Smazat
      </Button>
    </form>
  );
}
