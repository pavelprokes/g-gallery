/**
 * Beyond this the badge reads "99+" rather than a number nobody acts on.
 *
 * It lives here, not in lib/feed, because it is a display limit — how wide the
 * pill may grow — and because lib/feed reaches the database. This module is
 * imported by the top bar, which is a Client Component: pulling feed.ts in
 * behind it dragged Prisma and `pg` into the browser bundle and broke the build.
 */
export const BADGE_CAP = 99;

export type NavItem = {
  href: string;
  label: string;
  /**
   * `true` matches the pathname exactly, `false` matches any descendant. The
   * overview lives at the root of the section, so a prefix match there would
   * light it up on every single admin page.
   */
  exact: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Přehled", exact: true },
  { href: "/admin/updates", label: "Aktivita", exact: false },
  { href: "/admin/promo", label: "Reklama", exact: false },
];

export function isNavActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

/** `null` when there is nothing unread — the badge should not render at all. */
export function badgeLabel(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > BADGE_CAP ? `${BADGE_CAP}+` : String(unread);
}
