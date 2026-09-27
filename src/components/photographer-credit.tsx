import { useTranslations } from "next-intl";

const MAIN_SITE_URL =
  "https://svatebni-fotograf-cechy.cz/?utm_source=galerie&utm_medium=hlavicka-galerie";

/**
 * "Fotograf: Pavel Prokeš" under a gallery's or a wedding's title, linking to the main site.
 *
 * `noreferrer`: these pages' URLs carry the share token (CLAUDE.md invariant 7,
 * same as the promo tile). A new tab: a guest mid-upload must not lose it.
 */
export function PhotographerCredit({ className = "" }: { className?: string }) {
  const t = useTranslations("gallery");
  return (
    <p className={className}>
      {t.rich("photographerCredit", {
        link: (name) => (
          <a
            href={MAIN_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {name}
          </a>
        ),
      })}
    </p>
  );
}
