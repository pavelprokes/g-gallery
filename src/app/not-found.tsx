"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ContactLine, DeadEnd } from "@/components/dead-end";
import { buttonClasses } from "@/components/ui/button";

/**
 * The app's only 404 page, on purpose.
 *
 * Nested `not-found.tsx` files inside dynamic routes are not reliably used in
 * production — a long-standing App Router behaviour, and the reason
 * `/g/{bad-token}` served Next's built-in 404 on Vercel while rendering ours
 * locally. The root file is the one that is always used, so the wording is
 * chosen here from the path instead: `/g/` is a gallery link, `/s/` a whole
 * wedding, `/admin` the photographer's own mistake.
 *
 * A client component because that is the only way to see the path at all —
 * `not-found.tsx` receives no params.
 */
export default function NotFound() {
  const pathname = usePathname();
  const t = useTranslations("errors");

  if (pathname.startsWith("/admin")) {
    return (
      <DeadEnd
        title="Tady nic není"
        lead="Tahle adresa v administraci neexistuje."
        action={
          <Link href="/admin" className={buttonClasses()}>
            Zpátky na přehled
          </Link>
        }
      />
    );
  }

  // Both share links land here, and both fail the same way: the address gets
  // cut in half on its way through a chat. That is the first thing to say,
  // because it is the one thing the visitor can actually fix.
  if (pathname.startsWith("/g/") || pathname.startsWith("/s/")) {
    return (
      <DeadEnd
        title={t("linkNotFoundTitle")}
        lead={t("linkNotFoundLead")}
        hint={t("linkNotFoundHint")}
        action={<ContactLine />}
      />
    );
  }

  return <DeadEnd title={t("genericNotFoundTitle")} lead={t("genericNotFoundLead")} />;
}
