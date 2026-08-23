import type { ReactNode } from "react";

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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 text-center shadow-sm dark:bg-neutral-900">
        <span
          aria-hidden
          className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
        >
          {/* Drawn, not typed: a glyph like ✂ renders as a colour emoji on
              iOS, which is most of the traffic that reaches this page. A photo
              frame rather than a warning sign — nothing is broken on the
              visitor's side, and the words already say what happened. */}
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

        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2.5 text-sm/6 text-neutral-600 dark:text-neutral-300">{lead}</p>
        {hint && <p className="mt-2 text-sm/6 text-neutral-500 dark:text-neutral-400">{hint}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </main>
  );
}

/** Contact for the photographer, when the deployment has one configured. */
export function ContactLine() {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  if (!email) return null;

  return (
    <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
      Pořád nic?{" "}
      <a href={`mailto:${email}`} className="underline">
        Napiš mi
      </a>
      , mrknu se na to.
    </p>
  );
}
