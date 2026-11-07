"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ListView = "tiles" | "rows";

const KEY = "admin-list-view";
const OPTIONS: { view: ListView; label: string }[] = [
  { view: "tiles", label: "Dlaždice" },
  { view: "rows", label: "Řádky" },
];

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Storage can throw where it is blocked: the switch then lasts as long as the page. */
let unsaved: ListView = "tiles";

function read(): ListView {
  try {
    return sessionStorage.getItem(KEY) === "rows" ? "rows" : "tiles";
  } catch {
    return unsaved;
  }
}

function choose(view: ListView) {
  unsaved = view;
  try {
    sessionStorage.setItem(KEY, view);
  } catch {}
  for (const listener of listeners) listener();
}

/**
 * The overview's lists as tiles or rows, kept for the tab's session. One markup
 * for both: the `rows:` variant (src/app/globals.css) restyles it, so the server
 * renders the page once and a change of view fetches nothing.
 */
export function AdminListView({ children }: { children: ReactNode }) {
  const current = useSyncExternalStore(subscribe, read, () => "tiles" as const);
  return (
    <div data-view={current}>
      <div role="group" aria-label="Zobrazení seznamů" className="mt-6 flex justify-end gap-1">
        {OPTIONS.map(({ view, label }) => (
          <Button
            key={view}
            size="sm"
            variant="secondary"
            className="aria-pressed:border-brand-primary aria-pressed:bg-admin-accent-soft"
            aria-pressed={view === current}
            onClick={() => choose(view)}
          >
            {label}
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}
