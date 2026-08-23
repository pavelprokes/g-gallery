"use client";

import { useState } from "react";
import { updateEvent } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";

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
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Upravit
      </Button>
    );
  }

  return (
    <Card
      as="form"
      action={async (formData: FormData) => {
        await updateEvent(eventId, formData);
        setOpen(false);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor="event-title">Pár</Label>
        <Input id="event-title" name="title" required maxLength={200} defaultValue={title} />
      </div>
      <div>
        <Label htmlFor="event-date">Datum</Label>
        <Input id="event-date" name="eventDate" type="date" defaultValue={eventDate ?? ""} />
      </div>
      <div className="min-w-48 flex-1">
        <Label htmlFor="event-venue">Místo</Label>
        <Input id="event-venue" name="venue" maxLength={200} defaultValue={venue ?? ""} />
      </div>
      <Button type="submit" size="lg">
        Uložit
      </Button>
      <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
        Zrušit
      </Button>
      <Hint className="w-full">
        Adresa svatby se nezmění — je zamrazená od založení, aby vytištěný QR kód dál fungoval.
      </Hint>
    </Card>
  );
}
