"use client";

import { useState } from "react";
import { updateGallery } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";
import { TranslationFields } from "@/components/admin/translation-fields";
import type { ContentTranslations } from "@/lib/content-translations";

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
  translations,
  webSlug,
}: {
  galleryId: string;
  title: string;
  eventDate: string | null;
  description: string | null;
  translations: ContentTranslations<"title">;
  webSlug: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);

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
        const result = await updateGallery(galleryId, formData);
        setSlugTaken(result?.error === "WEB_SLUG_TAKEN");
        if (!result) setOpen(false);
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
      <div className="min-w-48 flex-1">
        <Label htmlFor="gallery-web-slug">Adresa na webu</Label>
        <Input
          id="gallery-web-slug"
          name="webSlug"
          maxLength={120}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="eliska-a-martin-2026"
          defaultValue={webSlug ?? ""}
        />
        {slugTaken && <Hint className="text-red-700">Tuhle adresu už má jiná galerie.</Hint>}
      </div>
      <TranslationFields
        className="w-full"
        values={translations}
        fields={[{ name: "title", label: "Název", maxLength: 200, original: title }]}
      />
      <Button type="submit" size="lg">
        Uložit
      </Button>
      <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
        Zrušit
      </Button>
      <Hint className="w-full">
        Adresy odkazů se nezmění — jsou zamrazené od vytvoření, aby už rozeslané fungovaly dál.
        Adresa na webu dělá z galerie webovou: publikovaná se ukáže v portfoliu pod touto adresou.
      </Hint>
    </Card>
  );
}
