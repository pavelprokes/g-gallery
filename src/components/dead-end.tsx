import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SiteFooterIdentity } from "@/components/site-footer-identity";
import { Card } from "@/components/ui/card";

/**
 * The shell every standalone guest screen shares: the password gate, the dead
 * ends, and the gallery's error boundary. Before this there were four different
 * takes on "one box in the middle of the page" — three of them hand-rolled — so
 * the first screen a paying client saw (the password gate) looked like a login
 * to somebody's admin panel while the 404 next to it looked like the product.
 *
 * What the shell guarantees, and why each part is here rather than at the call
 * site:
 *
 * - **A `Card`, not a bare `<div>`.** The same warm border and surface as every
 *   other panel in the app, so a screen the visitor reaches by accident still
 *   reads as the same product as the gallery they were trying to open.
 * - **`SiteFooterIdentity`, always.** Whatever went wrong, the visitor can see
 *   whose gallery this is and how to reach them. A dead end without a name on
 *   it is where a wedding guest gives up.
 * - **No brand font declaration.** `.font-brand` comes from the guest route
 *   layouts (`src/app/g/layout.tsx`, `src/app/s/layout.tsx`); the root 404 is
 *   deliberately outside them because it also serves `/admin`, which is
 *   sans-serif by design.
 */
export function GuestScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <Card className="w-full max-w-sm p-8 text-center">{children}</Card>
      <SiteFooterIdentity className="text-caption max-w-sm text-center text-neutral-500 dark:text-neutral-400" />
    </main>
  );
}

/**
 * The product's mark on the screens that have no photographs to show yet — the
 * password gate, a dead end, a failed load.
 *
 * Drawn, not typed: a glyph like ✂ renders as a colour emoji on iOS, which is
 * most of the traffic that lands here. A photo frame rather than a warning sign
 * — on a dead end nothing is broken on the visitor's side and the words already
 * say what happened, and on the password gate there is nothing wrong at all.
 */
export function BrandMark() {
  return (
    <span
      aria-hidden
      className="bg-brand-tint text-brand-primary dark:text-brand-border mx-auto mb-5 flex size-12 items-center justify-center rounded-full dark:bg-neutral-800"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-6"
      >
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3 16l4.5-4.5 3.5 3.5" />
        <path d="M13 15l2.5-2.5L21 18" />
        <circle cx="15" cy="9.5" r="1.1" />
      </svg>
    </span>
  );
}

/**
 * Every dead end in the app looks like this one component: a mistyped link, an
 * expired one, a gallery the photographer took down.
 *
 * The rules it exists to enforce:
 *
 * - **Say the likely cause, not the error.** Someone who taps a link from a
 *   wedding chat and lands here does not care that it was a 404. They care
 *   whether it is their fault and what to do next, and the answer is almost
 *   always "the address got cut in half when it was pasted".
 * - **No retry button.** It would fail identically and only move the blame.
 *   (The gallery's error boundary is the one screen that legitimately offers
 *   one — a transient load failure really can succeed on a second try — which
 *   is why it composes `GuestScreen` directly instead of going through here.)
 * - **Never confirm whether the link ever existed.** Expired and revoked read
 *   the same on purpose: telling them apart says whether the photographer cut
 *   somebody off deliberately.
 * - It should look like the gallery, not like a crash.
 */
export function DeadEnd({
  title,
  lead,
  hint,
  action,
}: {
  title: string;
  lead: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <GuestScreen>
      <BrandMark />

      <h1 className="text-brand-ink text-title font-semibold text-balance dark:text-neutral-100">
        {title}
      </h1>
      <p className="text-body mt-2.5 text-neutral-600 dark:text-neutral-300">{lead}</p>
      {hint && <p className="text-body mt-2 text-neutral-500 dark:text-neutral-400">{hint}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </GuestScreen>
  );
}

/** Contact for the photographer, when the deployment has one configured. */
export function ContactLine() {
  const t = useTranslations("errors");
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  if (!email) return null;

  return (
    <p className="text-body mt-6 text-neutral-500 dark:text-neutral-400">
      {t.rich("contact", {
        a: (chunks) => (
          <a href={`mailto:${email}`} className="underline">
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}
