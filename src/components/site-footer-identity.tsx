"use client";

import { useLocale, useTranslations } from "next-intl";
import { isLocale } from "@/i18n/locales";
import { guidePath } from "@/lib/guide-path";
import { SLIDESHOW_PATHS } from "@/lib/slideshow-path";

const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";

/** The public pages, so a footer can say which one it sits on. */
export type FooterPage = "help" | "guide" | "slideshow";

/**
 * Legal identity block — name, contact, copyright year, on every public
 * footer. IČO and the registered address are legally required to be *easily
 * findable* on the site, not repeated on every page, so `full` (name, IČO,
 * address, contact) is reserved for the homepage; everywhere else gets
 * `minimal` (name, contact) — matching the main site's own footer
 * (svatebni-fotograf-cechy.cz).
 *
 * Above it, the same list of the public pages on every footer of the site —
 * help, guide, slideshow maker, the photographer — in the viewer's language,
 * so any page leads to the others. The page the footer is on stays in the
 * list, marked current, so the list reads the same everywhere.
 */
export function SiteFooterIdentity({
  className = "",
  variant = "minimal",
  current,
}: {
  className?: string;
  variant?: "full" | "minimal";
  /** The public page this footer is on, marked in the list of links. */
  current?: FooterPage;
}) {
  const t = useTranslations("siteFooter");
  const raw = useLocale();
  const locale = isLocale(raw) ? raw : "en";
  const links: { page: FooterPage | "photographer"; href: string; label: string }[] = [
    { page: "help", href: "/", label: t("help") },
    { page: "guide", href: guidePath(locale), label: t("guide") },
    { page: "slideshow", href: SLIDESHOW_PATHS[locale], label: t("slideshow") },
    { page: "photographer", href: MAIN_SITE_URL, label: t("photographer") },
  ];

  return (
    <div className={className}>
      <nav aria-label={t("links")} className="mb-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <li key={link.page}>
              <a
                href={link.href}
                aria-current={link.page === current ? "page" : undefined}
                className="inline-block py-1 underline underline-offset-4 aria-[current=page]:font-semibold aria-[current=page]:no-underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p>
        <strong>Pavel Prokeš</strong> — {t("role")}
        {variant === "full" && (
          <>
            <br />
            {t("businessId")} · {t("address")}
          </>
        )}
        <br />
        <a href={`mailto:${t("email")}`} className="underline">
          {t("email")}
        </a>{" "}
        ·{" "}
        <a href={MAIN_SITE_URL} className="underline" target="_blank" rel="noreferrer">
          {t("website")}
        </a>
      </p>
      {/* suppressHydrationWarning: the only way this mismatches server output
          is a request straddling midnight on New Year's Eve — harmless, and
          not worth an effect + loading state to avoid. */}
      <p className="mt-2" suppressHydrationWarning>
        {t("copyright", { year: new Date().getFullYear() })}
      </p>
      <p className="mt-2">{t("builtBy")}</p>
    </div>
  );
}
