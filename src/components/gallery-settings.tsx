"use client";

import { useState } from "react";
import { updateGallery } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";

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
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Přejmenovat
      </Button>
    );
  }

  return (
    <Card
      as="form"
      action={async (formData: FormData) => {
        await updateGallery(galleryId, formData);
        setOpen(false);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor="gallery-title">Název</Label>
        <Input id="gallery-title" name="title" required maxLength={200} defaultValue={title} />
      </div>
      <div>
        <Label htmlFor="gallery-date">Datum akce</Label>
        <Input id="gallery-date" name="eventDate" type="date" defaultValue={eventDate ?? ""} />
      </div>
      <div className="min-w-48 flex-1">
        <Label htmlFor="gallery-description">Popis</Label>
        <Input
          id="gallery-description"
          name="description"
          maxLength={2000}
          defaultValue={description ?? ""}
        />
      </div>
      <Button type="submit" size="lg">
        Uložit
      </Button>
      <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
        Zrušit
      </Button>
      <Hint className="w-full">
        Adresy odkazů se nezmění — jsou zamrazené od vytvoření, aby už rozeslané fungovaly dál.
      </Hint>
    </Card>
  );
}
