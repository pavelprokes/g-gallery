import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth-guard";
import { unreadCount } from "@/lib/feed";
import { AdminTopBar } from "@/components/admin/admin-top-bar";

// Every /admin/* page is auth-gated and has nothing to say to a search
// engine — explicit noindex here, rather than relying on Next's index/follow
// default, matches the same policy already set on /g/* and /s/*.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The admin shell: cream page, sticky top bar, one container width for every
 * page under it. Ported from the admin portal on the photographer's main site
 * (svatebni-fotograf-cechy-2.0/components/Admin/AdminLayout) so the two
 * back-offices feel like one product.
 *
 * `scheme-light` is not decoration. The portal is light-only, and globals.css
 * scopes Tailwind's `dark:` variant out of `[data-admin-shell]` — but native
 * widgets (<select>, <input type="date">, scrollbars) follow `color-scheme`,
 * which no media query can reach. Both halves are needed; either alone leaves
 * the portal half-dark on a machine set to dark mode.
 *
 * The session check here does NOT replace the per-page guards. Server Actions
 * are public POST endpoints and bypass layouts entirely (CLAUDE.md invariant
 * #3), so every page and action re-verifies. This one exists so the shell
 * knows whose name to show; better-auth's signed cookie cache makes the second
 * call a signature check, not a database round trip.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const unread = await unreadCount(session.user.id);

  return (
    <div data-admin-shell className="bg-admin-bg text-brand-ink min-h-dvh antialiased scheme-light">
      <a
        href="#admin-content"
        className="text-brand-primary-dark sr-only rounded-lg bg-white font-semibold focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:px-4 focus:py-2.5 print:hidden"
      >
        Přeskočit na obsah
      </a>

      <AdminTopBar userName={session.user.name ?? session.user.email} unread={unread} />

      <main id="admin-content" className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-5 sm:pt-7">
        {children}
      </main>
    </div>
  );
}
