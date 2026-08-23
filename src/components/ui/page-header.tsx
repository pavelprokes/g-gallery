import type { ReactNode } from "react";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";

/**
 * The top of every admin page: where you are, what this page is, and what you
 * can do to it. Replaces six hand-rolled `<header>` blocks that had each
 * invented their own title size, back link, and action placement.
 *
 * `actions` sits on the same baseline as the title on a wide screen and wraps
 * underneath it on a narrow one — the buttons stay reachable without pushing
 * the title into two lines.
 */
export function PageHeader({
  title,
  crumbs = [],
  subtitle,
  actions,
}: {
  title: string;
  crumbs?: Crumb[];
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 print:hidden">
      <Breadcrumbs items={crumbs} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-bold [overflow-wrap:anywhere]">{title}</h1>
          {subtitle && (
            <p className="text-admin-muted mt-1 text-sm dark:text-neutral-400">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
