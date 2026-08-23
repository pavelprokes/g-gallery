"use client";

import { useState } from "react";

/**
 * Copies a link to the clipboard and says so. Takes a path or a full URL: a
 * value starting with "/" is resolved against the current origin, so server
 * components can hand over `/s/{token}/{slug}` without knowing the host.
 *
 * The copied text is also rendered next to the button — a copy control whose
 * value you cannot see is a control you cannot check, and these are links that
 * go on printed signage.
 */
export function CopyButton({
  value,
  label = "Kopírovat odkaz",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="border-admin-border text-brand-primary-dark hover:border-brand-primary hover:text-brand-primary inline-flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
      onClick={() => {
        const url = value.startsWith("/") ? `${window.location.origin}${value}` : value;
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span aria-hidden>{copied ? "✓" : "⧉"}</span>
      {copied ? "Zkopírováno" : "Kopírovat"}
    </button>
  );
}

/** A link with its address shown and a copy control beside it. */
export function CopyableLink({ href, note }: { href: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="bg-admin-surface-muted border-admin-border min-w-0 flex-1 truncate rounded border px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
        {href}
      </code>
      <CopyButton value={href} />
      {note && <span className="text-admin-muted text-xs dark:text-neutral-400">{note}</span>}
    </div>
  );
}

/** What is shown where a link would be, when it cannot be recovered. */
export function UnrecoverableLink({ reason }: { reason: string }) {
  return <p className="text-admin-muted text-xs dark:text-neutral-400">{reason}</p>;
}
