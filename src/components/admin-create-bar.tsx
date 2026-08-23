"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createEvent } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";

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
        <Button type="button" onClick={() => setOpen(open === "wedding" ? null : "wedding")}>
          + Nová svatba
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen(open === "gallery" ? null : "gallery")}
        >
          + Samostatná galerie
        </Button>
      </div>

      {open === "wedding" && (
        <Card as="form" action={submitWedding} className="mt-4">
          <Hint className="mt-0 mb-3">
            Jedna adresa, na kterou vede QR kód. Galerie se na ni přidávají později — a adresa se
            tím nemění.
          </Hint>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="new-event-title">Pár</Label>
              <Input
                id="new-event-title"
                name="title"
                required
                maxLength={200}
                placeholder="Pavel a Patricie"
              />
            </div>
            <div>
              <Label htmlFor="new-event-date">Datum</Label>
              <Input id="new-event-date" name="eventDate" type="date" />
            </div>
            <div className="min-w-48 flex-1">
              <Label htmlFor="new-event-venue">Místo</Label>
              <Input
                id="new-event-venue"
                name="venue"
                maxLength={200}
                placeholder="Statek Benice"
              />
            </div>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Zakládám…" : "Vytvořit"}
            </Button>
          </div>
        </Card>
      )}

      {open === "gallery" && (
        <Card as="form" action={createGalleryAction} className="mt-4">
          <Hint className="mt-0 mb-3">
            Galerie mimo svatbu — klientská zakázka, která rozcestník nepotřebuje. Do svatby jde
            připojit i později.
          </Hint>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="new-gallery-solo-title">Název</Label>
              <Input id="new-gallery-solo-title" name="title" required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="new-gallery-solo-date">Datum akce</Label>
              <Input id="new-gallery-solo-date" name="eventDate" type="date" />
            </div>
            <Button type="submit" size="lg">
              Vytvořit
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}
