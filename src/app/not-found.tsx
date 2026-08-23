"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ContactLine, DeadEnd } from "@/components/dead-end";

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

  if (pathname.startsWith("/admin")) {
    return (
      <DeadEnd
        title="Tady nic není"
        lead="Tahle adresa v administraci neexistuje."
        action={
          <Link href="/admin" className="rounded-lg border px-4 py-2 text-sm">
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
        title="Tenhle odkaz nikam nevede"
        lead="Nejspíš se z chatu zkopírovala jen část adresy — stává se to pořád. Zkus ji otevřít znovu přímo z původní zprávy, nebo naskenuj QR kód, jestli ho máš po ruce."
        hint="Když to nepomůže, napiš novomanželům. Odkaz mají u sebe."
        action={<ContactLine />}
      />
    );
  }

  return <DeadEnd title="Tady nic není" lead="Tahle adresa nikam nevede." />;
}
