"use client";

import { useState } from "react";
import { createShareLink, revokeShareLink } from "@/app/admin/actions";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";

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
}: {
  galleryId: string;
  shareLinks: ShareLinkRow[];
  published: boolean;
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
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Sdílené odkazy</h2>

      {!published && (
        // Every share surface refuses an unpublished gallery, so a link created
        // now looks valid but 404s until the gallery is published.
        <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
          Galerie zatím není publikovaná — odkazy vytvořené teď budou vracet 404, dokud ji
          nepublikuješ.
        </p>
      )}

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="galleryId" value={galleryId} />
        <label className="flex flex-col gap-1 text-sm">
          Popis
          <input name="label" maxLength={200} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Heslo (volitelné)
          <input name="password" type="text" minLength={4} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Platnost (dnů)
          <input
            name="expiresInDays"
            type="number"
            min={1}
            max={3650}
            className="w-28 rounded border px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input name="allowUpload" type="checkbox" value="1" className="size-4" />
          Hosté smí nahrávat
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Vytvořit odkaz
        </button>
      </form>

      {freshUrl && (
        <div className="mt-3 rounded border border-emerald-400 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
          <p className="font-medium">Odkaz vytvořen</p>
          <div className="mt-2">
            <CopyableLink href={freshUrl} />
          </div>
          {!published && (
            <p className="mt-1 text-xs">Než ho pošleš, galerii publikuj — jinak vrací 404.</p>
          )}
        </div>
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
                <button
                  type="button"
                  className="rounded border px-2 py-1 text-xs text-red-600"
                  onClick={() => void revokeShareLink(link.id)}
                >
                  Zrušit
                </button>
              )}
            </div>
            {!link.revokedAt &&
              (link.url ? (
                <CopyableLink href={link.url} />
              ) : (
                <UnrecoverableLink reason="Adresu už nelze zobrazit — vznikla dřív, než se odkazy ukládaly čitelně. Vytvoř nový." />
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
