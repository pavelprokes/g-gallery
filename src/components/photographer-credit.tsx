import { useTranslations } from "next-intl";

const MAIN_SITE_URL =
  "https://svatebni-fotograf-cechy.cz/?utm_source=galerie&utm_medium=hlavicka-galerie";

/** "Fotograf: Pavel Prokeš" under a gallery's or a wedding's title, linking to the main site. */
export function PhotographerCredit({ className = "" }: { className?: string }) {
  const t = useTranslations("gallery");
  return (
    <p className={className}>
      {t.rich("photographerCredit", {
        link: (name) => (
          <a href={MAIN_SITE_URL} className="underline underline-offset-2">
            {name}
          </a>
        ),
      })}
    </p>
  );
}
