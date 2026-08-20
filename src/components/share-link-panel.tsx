"use client";

import { useState } from "react";
import { createShareLink, revokeShareLink } from "@/app/admin/actions";

interface ShareLinkRow {
  id: string;
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  passwordHash: string | null;
  createdAt: Date;
}

export function ShareLinkPanel({
  galleryId,
  shareLinks,
}: {
  galleryId: string;
  shareLinks: ShareLinkRow[];
}) {
  // The raw token exists only in this response — only its hash is stored, so
  // it can never be shown again after a reload.
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    try {
      const token = await createShareLink(formData);
      setFreshUrl(`${window.location.origin}/g/${token}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Sdílené odkazy</h2>

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
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Vytvořit odkaz
        </button>
      </form>

      {freshUrl && (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">Odkaz zkopíruj teď — už se nikdy nezobrazí.</p>
          <code className="mt-1 block text-xs break-all">{freshUrl}</code>
          <button
            type="button"
            className="mt-2 rounded border px-2 py-1 text-xs"
            onClick={() => void navigator.clipboard.writeText(freshUrl)}
          >
            Kopírovat
          </button>
        </div>
      )}

      <ul className="mt-4 divide-y text-sm">
        {shareLinks.length === 0 && <li className="py-2 text-neutral-500">Žádné odkazy.</li>}
        {shareLinks.map((link) => (
          <li key={link.id} className="flex items-center justify-between py-2">
            <div>
              <p>{link.label ?? "Bez popisu"}</p>
              <p className="text-xs text-neutral-500">
                {link.revokedAt
                  ? "Zrušen"
                  : link.expiresAt
                    ? `Platí do ${link.expiresAt.toLocaleDateString("cs-CZ")}`
                    : "Bez expirace"}
                {link.passwordHash && " · chráněno heslem"}
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
          </li>
        ))}
      </ul>
    </section>
  );
}
