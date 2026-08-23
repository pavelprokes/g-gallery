"use client";

import { useState } from "react";
import Link from "next/link";
import { createShareLink, revokeShareLink } from "@/app/admin/actions";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ShareLinkRow {
  id: string;
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  passwordHash: string | null;
  allowUpload: boolean;
  createdAt: Date;
  /** Path built server-side from the decrypted token; null when unreadable. */
  url: string | null;
}

export function ShareLinkPanel({
  galleryId,
  shareLinks,
  published,
  hostedByEvent = false,
}: {
  galleryId: string;
  shareLinks: ShareLinkRow[];
  published: boolean;
  /**
   * When this gallery belongs to a wedding page, the printable sign belongs
   * there instead (docs/GUEST-GALLERIES.md §2/F7): the event address survives
   * galleries coming and going, a gallery's own `/g/` link does not.
   */
  hostedByEvent?: boolean;
}) {
  // The raw token exists only in this response — only its hash is stored, so
  // it can never be shown again after a reload.
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    try {
      const { token, slug } = await createShareLink(formData);
      setFreshUrl(`${window.location.origin}/g/${token}/${slug}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card as="section">
      <CardTitle>Sdílené odkazy</CardTitle>

      {!published && (
        // Every share surface refuses an unpublished gallery, so a link created
        // now looks valid but 404s until the gallery is published.
        <Alert compact className="mt-2">
          Galerie zatím není publikovaná — odkazy vytvořené teď budou vracet 404, dokud ji
          nepublikuješ.
        </Alert>
      )}

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="galleryId" value={galleryId} />
        <label className="flex flex-col gap-1 text-sm">
          Popis
          <Input name="label" maxLength={200} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Heslo (volitelné)
          <Input name="password" type="text" minLength={4} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Platnost (dnů)
          <Input name="expiresInDays" type="number" min={1} max={3650} className="w-28" />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input name="allowUpload" type="checkbox" value="1" className="size-4" />
          Hosté smí nahrávat
        </label>
        <Button type="submit" disabled={pending}>
          Vytvořit odkaz
        </Button>
      </form>

      {freshUrl && (
        <Alert tone="success" className="mt-3">
          <p className="font-medium">Odkaz vytvořen</p>
          <div className="mt-2">
            <CopyableLink href={freshUrl} />
          </div>
          {!published && (
            <p className="mt-1 text-xs">Než ho pošleš, galerii publikuj — jinak vrací 404.</p>
          )}
        </Alert>
      )}

      <ul className="mt-4 divide-y text-sm">
        {shareLinks.length === 0 && <li className="py-2 text-neutral-500">Žádné odkazy.</li>}
        {shareLinks.map((link) => (
          <li key={link.id} className="space-y-2 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p>{link.label ?? "Bez popisu"}</p>
                <p className="text-xs text-neutral-500">
                  {link.revokedAt
                    ? "Zrušen"
                    : link.expiresAt
                      ? `Platí do ${link.expiresAt.toLocaleDateString("cs-CZ")}`
                      : "Bez expirace"}
                  {link.passwordHash && " · chráněno heslem"}
                  {link.allowUpload && " · hosté nahrávají"}
                </p>
              </div>
              {!link.revokedAt && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void revokeShareLink(link.id)}
                >
                  Zrušit
                </Button>
              )}
            </div>
            {!link.revokedAt &&
              (link.url ? (
                <CopyableLink href={link.url} />
              ) : (
                <UnrecoverableLink reason="Adresu už nelze zobrazit — vznikla dřív, než se odkazy ukládaly čitelně. Vytvoř nový." />
              ))}
            {!link.revokedAt && link.allowUpload && !link.passwordHash && !hostedByEvent && (
              <Link
                href={`/admin/g/${galleryId}/sign?linkId=${link.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                Cedulka k tisku
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
