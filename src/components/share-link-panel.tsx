"use client";

import { useState } from "react";
import Link from "next/link";
import { createShareLink, revokeShareLink, updateShareLinkPermissions } from "@/app/admin/actions";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * The four switches every viewer surface already reads. They live in one list
 * so the create form, the edit form and the summary line can never drift into
 * describing a different set of permissions from each other.
 */
const PERMISSIONS = [
  { name: "allowDownload", label: "Stahování", summary: "stahování" },
  { name: "allowReactions", label: "Srdíčka a reakce", summary: "reakce" },
  { name: "allowPrintSelection", label: "Označování do tisku", summary: "výběr do tisku" },
  { name: "allowUpload", label: "Hosté smí nahrávat", summary: "hosté nahrávají" },
] as const;

type PermissionName = (typeof PERMISSIONS)[number]["name"];
type Permissions = Record<PermissionName, boolean>;

/**
 * The three link shapes a wedding actually needs, as the photographer names
 * them. A preset only fills the boxes in — every one of them stays visible and
 * editable afterwards, because the presets are a shortcut, not a mode.
 */
const PRESETS = [
  {
    id: "sneak",
    label: "Ochutnávka na sítě",
    hint: "jen prohlížení, platnost 14 dní",
    expiresInDays: "14",
    permissions: {
      allowDownload: false,
      allowReactions: true,
      allowPrintSelection: false,
      allowUpload: false,
    },
  },
  {
    id: "delivery",
    label: "Předání fotek",
    hint: "stahování zapnuté, bez expirace",
    expiresInDays: "",
    permissions: {
      allowDownload: true,
      allowReactions: true,
      allowPrintSelection: true,
      allowUpload: false,
    },
  },
  {
    id: "selection",
    label: "Výběr do alba",
    hint: "označování do tisku, stahování vypnuté",
    expiresInDays: "",
    permissions: {
      allowDownload: false,
      allowReactions: true,
      allowPrintSelection: true,
      // The couple is choosing from the photographer's frames here, not adding
      // their own — leaving uploads on would invite exactly the crops this
      // preset exists to keep out.
      allowUpload: false,
    },
  },
] as const;

/** Same defaults every link got before the switches were exposed. */
const DEFAULT_PERMISSIONS: Permissions = PRESETS[1].permissions;

interface ShareLinkRow {
  id: string;
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  passwordHash: string | null;
  allowDownload: boolean;
  allowReactions: boolean;
  allowPrintSelection: boolean;
  allowUpload: boolean;
  createdAt: Date;
  /** Path built server-side from the decrypted token; null when unreadable. */
  url: string | null;
}

function PermissionCheckbox({
  name,
  label,
  checked,
  defaultChecked,
  onChange,
}: {
  name: PermissionName;
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <label className="text-body flex items-center gap-2">
      <input
        name={name}
        type="checkbox"
        value="1"
        className="size-4"
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
      />
      {label}
    </label>
  );
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
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_PERMISSIONS);
  const [expiresInDays, setExpiresInDays] = useState("");

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-admin-muted text-caption dark:text-neutral-400">
          Předvyplnit jako
        </span>
        {PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="secondary"
            size="sm"
            title={preset.hint}
            onClick={() => {
              setPermissions(preset.permissions);
              setExpiresInDays(preset.expiresInDays);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <form action={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="galleryId" value={galleryId} />
        <label className="text-body flex flex-col gap-1">
          Popis
          <Input name="label" maxLength={200} />
        </label>
        <label className="text-body flex flex-col gap-1">
          Heslo (volitelné)
          <Input name="password" type="text" minLength={4} />
        </label>
        <label className="text-body flex flex-col gap-1">
          Platnost (dnů)
          <Input
            name="expiresInDays"
            type="number"
            min={1}
            max={3650}
            className="w-28"
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1.5">
          {PERMISSIONS.map((permission) => (
            <PermissionCheckbox
              key={permission.name}
              name={permission.name}
              label={permission.label}
              checked={permissions[permission.name]}
              onChange={(next) =>
                setPermissions((current) => ({ ...current, [permission.name]: next }))
              }
            />
          ))}
        </div>
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
            <p className="text-caption mt-1">Než ho pošleš, galerii publikuj — jinak vrací 404.</p>
          )}
        </Alert>
      )}

      <ul className="text-body mt-4 divide-y">
        {shareLinks.length === 0 && <li className="py-2 text-neutral-500">Žádné odkazy.</li>}
        {shareLinks.map((link) => {
          const granted = PERMISSIONS.filter((permission) => link[permission.name]);
          return (
            <li key={link.id} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p>{link.label ?? "Bez popisu"}</p>
                  <p className="text-caption text-neutral-500">
                    {link.revokedAt
                      ? "Zrušen"
                      : link.expiresAt
                        ? `Platí do ${link.expiresAt.toLocaleDateString("cs-CZ")}`
                        : "Bez expirace"}
                    {link.passwordHash && " · chráněno heslem"}
                    {granted.length > 0
                      ? ` · ${granted.map((permission) => permission.summary).join(", ")}`
                      : " · jen prohlížení"}
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
              {!link.revokedAt && (
                // Editable in place, because the alternative is revoking a URL
                // the couple has already forwarded to the whole family.
                <details>
                  <summary className="text-admin-muted text-caption cursor-pointer dark:text-neutral-400">
                    Upravit oprávnění
                  </summary>
                  <form
                    action={updateShareLinkPermissions.bind(null, link.id)}
                    className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    {PERMISSIONS.map((permission) => (
                      <PermissionCheckbox
                        key={permission.name}
                        name={permission.name}
                        label={permission.label}
                        defaultChecked={link[permission.name]}
                      />
                    ))}
                    <Button type="submit" variant="secondary" size="sm">
                      Uložit
                    </Button>
                  </form>
                </details>
              )}
              {!link.revokedAt && link.allowUpload && !link.passwordHash && !hostedByEvent && (
                <Link
                  href={`/admin/g/${galleryId}/sign?linkId=${link.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Cedulka k tisku
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
