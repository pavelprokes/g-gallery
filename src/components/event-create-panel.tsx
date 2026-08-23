"use client";

import { useState } from "react";
import { createEvent } from "@/app/admin/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Creating a wedding page reveals its URL exactly once — only the token's
 * SHA-256 is stored (invariant 5), so it cannot be shown again afterwards.
 * Same contract as {@link ShareLinkPanel}, and the same warning, because
 * losing this one means the whole page has to be recreated.
 */
export function EventCreatePanel() {
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    try {
      const { token, slug } = await createEvent(formData);
      setFreshUrl(`${window.location.origin}/s/${token}/${slug}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card as="section">
      <h2 className="text-sm font-medium">Nová svatba</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Jedna adresa, na kterou vede QR kód. Galerie se na ni přidávají později — a odkaz se tím
        nemění.
      </p>

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Pár
          <Input name="title" required maxLength={200} placeholder="Pavel a Patricie" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Datum
          <Input name="eventDate" type="date" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Místo
          <Input name="venue" maxLength={200} placeholder="Statek Benice" />
        </label>
        <Button type="submit" disabled={pending}>
          Vytvořit
        </Button>
      </form>

      {freshUrl && (
        <Alert className="mt-3">
          <p className="font-medium">Adresu zkopíruj teď — už se nikdy nezobrazí.</p>
          <code className="mt-1 block text-xs break-all">{freshUrl}</code>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void navigator.clipboard.writeText(freshUrl)}
          >
            Kopírovat
          </Button>
        </Alert>
      )}
    </Card>
  );
}
