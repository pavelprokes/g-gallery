import Link from "next/link";

export type Crumb = {
  label: string;
  /** Omitted on the last crumb — the page you are already on is not a link. */
  href?: string;
};

/**
 * Where you are in wedding → gallery → printable sign. The admin on the
 * photographer's main site has no breadcrumb — one flat list of orders needs
 * only a "back" button — but this hierarchy is a level deeper, and a lone
 * back arrow cannot say whether a gallery belongs to a wedding.
 *
 * The last crumb is the current page: `aria-current="page"` and deliberately
 * not a link. Separators are `aria-hidden` — a screen reader announcing
 * "slash" between every step is noise, and the list markup already conveys
 * the structure.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Drobečková navigace" className="mb-2 print:hidden">
      <ol className="text-admin-muted flex flex-wrap items-center gap-1.5 text-sm dark:text-neutral-400">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.href ?? item.label}-${index}`} className="flex items-center gap-1.5">
              {isLast || !item.href ? (
                <span
                  aria-current="page"
                  title={item.label}
                  className="text-brand-ink max-w-[32ch] truncate font-semibold dark:text-neutral-100"
                >
                  {item.label}
                </span>
              ) : (
                <>
                  <Link
                    href={item.href}
                    title={item.label}
                    className="hover:text-brand-primary-dark max-w-[24ch] truncate hover:underline dark:hover:text-neutral-100"
                  >
                    {item.label}
                  </Link>
                  <span aria-hidden className="text-admin-border select-none dark:text-neutral-700">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
