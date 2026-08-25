"use client";

import { useTranslations } from "next-intl";

/**
 * Legal identity block — name, contact, copyright year, on every public
 * footer. IČO and the registered address are legally required to be *easily
 * findable* on the site, not repeated on every page, so `full` (name, IČO,
 * address, contact) is reserved for the homepage; everywhere else gets
 * `minimal` (name, contact) — matching the main site's own footer
 * (svatebni-fotograf-cechy.cz).
 */
export function SiteFooterIdentity({
  className = "",
  variant = "minimal",
}: {
  className?: string;
  variant?: "full" | "minimal";
}) {
  const t = useTranslations("siteFooter");

  return (
    <div className={className}>
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
        <a
          href="https://svatebni-fotograf-cechy.cz/"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
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
