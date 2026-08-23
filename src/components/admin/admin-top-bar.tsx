"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, badgeLabel, isNavActive } from "@/lib/admin-nav";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * The portal's one piece of persistent chrome, mirroring the admin on the
 * photographer's main site: brand, sections, who you are, and the way out.
 *
 * Active state is an `aria-current="page"` attribute that the styling hangs
 * off, rather than a conditional class — the accessible name and the visual
 * highlight then cannot drift apart, because they are the same fact.
 */
export function AdminTopBar({ userName, unread }: { userName: string; unread: number }) {
  const pathname = usePathname();
  const badge = badgeLabel(unread);

  return (
    <header className="border-admin-border sticky top-0 z-20 border-b bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-5">
        <Link
          href="/admin"
          className="text-brand-primary-dark hover:text-brand-primary text-sm font-bold tracking-wide uppercase"
        >
          Galerie
        </Link>

        <nav aria-label="Hlavní navigace administrace" className="flex flex-wrap gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item.href, item.exact);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="hover:text-brand-primary-dark aria-[current=page]:bg-admin-accent-soft aria-[current=page]:text-brand-primary-dark text-admin-muted inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
              >
                {item.label}
                {/* No count on the page you are already reading. */}
                {badge && item.href === "/admin/updates" && !active && (
                  <Badge tone="danger">{badge}</Badge>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="text-admin-muted ml-auto flex items-center gap-3 text-sm">
          <span className="hidden max-w-56 truncate sm:inline" title={userName}>
            {userName}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
