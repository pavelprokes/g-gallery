import type { ReactNode } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * An admin panel that stays closed until it is needed — set up once per
 * gallery (chapters, the highlights) and otherwise only in the way of the
 * photo grid below it. The summary keeps the panel's state visible while it
 * is closed, so closing it hides the controls, not the facts.
 */
export function CollapsiblePanel({
  title,
  status,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** One line shown beside the title, open or closed. */
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Card as="details" open={defaultOpen} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="text-admin-muted size-4 shrink-0 transition-transform group-open:rotate-90 dark:text-neutral-400" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <CardTitle className="mb-0">{title}</CardTitle>
          {status && (
            <span className="text-admin-muted text-sm dark:text-neutral-400">{status}</span>
          )}
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </Card>
  );
}
