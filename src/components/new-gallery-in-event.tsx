"use client";

import { useState } from "react";
import { createGalleryForEvent } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label, Select } from "@/components/ui/input";

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
    <Card as="section">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setOpen(open === "new" ? null : "new")}>
          + Nová galerie
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={unattached.length === 0}
          onClick={() => setOpen(open === "existing" ? null : "existing")}
          title={unattached.length === 0 ? "Všechny galerie už někam patří" : undefined}
        >
          Přidat existující ({unattached.length})
        </Button>
      </div>

      {open === "new" && (
        <form
          action={createGalleryForEvent.bind(null, eventId)}
          className="border-admin-border mt-4 flex flex-wrap items-end gap-3 border-t pt-4 dark:border-neutral-800"
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor="new-gallery-title">Název</Label>
            <Input
              id="new-gallery-title"
              name="title"
              required
              maxLength={200}
              placeholder="Od hostů"
            />
          </div>
          <div>
            <Label htmlFor="new-gallery-date">Datum akce</Label>
            <Input id="new-gallery-date" name="eventDate" type="date" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              name="allowUpload"
              type="checkbox"
              value="1"
              className="accent-brand-primary size-4"
            />
            Hosté sem smí nahrávat
          </label>
          <Button type="submit" size="lg">
            Vytvořit a připojit
          </Button>
          <Hint className="w-full">
            Vytvoří galerii, publikuje ji, založí odkaz a nastaví ho jako cestu z karty. Na
            rozcestníku se ale neobjeví, dokud ji sám nezobrazíš.
          </Hint>
        </form>
      )}

      {open === "existing" && unattached.length > 0 && (
        <form
          action={async (formData: FormData) => {
            await attach(eventId, String(formData.get("galleryId")));
            setOpen(null);
          }}
          className="border-admin-border mt-4 flex flex-wrap items-end gap-3 border-t pt-4 dark:border-neutral-800"
        >
          <Select name="galleryId" aria-label="Galerie k připojení" className="w-auto">
            {unattached.map((gallery) => (
              <option key={gallery.id} value={gallery.id}>
                {gallery.title}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" size="lg">
            Připojit
          </Button>
          <Hint className="w-full">
            Nezapomeň pak vybrat „Karta vede přes“ — bez toho se karta hostům nezobrazí.
          </Hint>
        </form>
      )}
    </Card>
  );
}
