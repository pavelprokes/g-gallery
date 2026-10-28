"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { formatDate } from "@/lib/format-date";
import { MAX_REEL_GALLERIES, reelsHref } from "@/lib/reels/sources";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface PickerGroup {
  /** A wedding's id, or a standalone gallery's own. */
  id: string;
  title: string;
  date: string | null;
  galleries: { id: string; title: string; photos: number }[];
}

/** Lists this long get a filter field. */
const FILTER_FROM = 8;

/**
 * Which weddings and albums the reel takes its photos from (docs/REELS.md §4).
 * Ticking is local; "Načíst fotky" puts the choice in the address, and the
 * page loads those galleries' photos — only then, so browsing the list costs
 * nothing.
 */
export function ReelSourcePicker({
  groups,
  selected,
}: {
  groups: PickerGroup[];
  selected: string[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<string[]>(selected);
  const [filter, setFilter] = useState("");
  const [loading, startLoading] = useTransition();
  const [open, setOpen] = useState(selected.length === 0);

  const set = (ids: string[], on: boolean) =>
    setChecked((prev) =>
      on
        ? [...prev, ...ids.filter((id) => !prev.includes(id))]
        : prev.filter((id) => !ids.includes(id)),
    );
  const changed = checked.join() !== selected.join();
  const tooMany = checked.length > MAX_REEL_GALLERIES;
  const needle = filter.trim().toLocaleLowerCase("cs");
  const shown = needle
    ? groups.filter((g) =>
        [g.title, ...g.galleries.map((x) => x.title)].some((t) =>
          t.toLocaleLowerCase("cs").includes(needle),
        ),
      )
    : groups;
  const titleOf = new Map(groups.flatMap((g) => g.galleries.map((x) => [x.id, x.title] as const)));

  return (
    <Card as="section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="mb-0">Odkud fotky</CardTitle>
        {selected.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Skrýt seznam" : "Změnit výběr"}
          </Button>
        )}
      </div>
      {!open && (
        <p className="mt-2 text-sm">{selected.map((id) => titleOf.get(id) ?? "?").join(" · ")}</p>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {groups.length >= FILTER_FROM && (
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Hledat svatbu nebo album"
              aria-label="Hledat svatbu nebo album"
              className="border-admin-border min-h-11 w-full rounded-lg border px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          )}
          {groups.length === 0 ? (
            <p className="text-sm">Zatím tu není žádná galerie s fotkami.</p>
          ) : (
            <ul className="divide-admin-border max-h-[26rem] divide-y overflow-y-auto dark:divide-neutral-800">
              {shown.map((group) => {
                const ids = group.galleries.map((g) => g.id);
                const all = ids.every((id) => checked.includes(id));
                const some = !all && ids.some((id) => checked.includes(id));
                const single = group.galleries.length === 1 && group.galleries[0]!.id === group.id;
                return (
                  <li key={group.id} className="py-2">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some;
                        }}
                        onChange={(e) => set(ids, e.target.checked)}
                        className="accent-brand-primary size-5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{group.title}</span>
                        <span className="text-admin-muted text-caption block dark:text-neutral-400">
                          {[
                            group.date && formatDate(new Date(group.date), "cs"),
                            single
                              ? pluralize(group.galleries[0]!.photos, FORMS.photo)
                              : pluralize(group.galleries.length, FORMS.gallery),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                    {!single && (
                      <ul className="mt-1 ml-8 space-y-0.5">
                        {group.galleries.map((g) => (
                          <li key={g.id}>
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                              <input
                                type="checkbox"
                                checked={checked.includes(g.id)}
                                onChange={(e) => set([g.id], e.target.checked)}
                                className="accent-brand-primary size-5"
                              />
                              <span>
                                {g.title}{" "}
                                <span className="text-admin-muted dark:text-neutral-400">
                                  · {pluralize(g.photos, FORMS.photo)}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!changed || tooMany || checked.length === 0 || loading}
              onClick={() =>
                startLoading(() => {
                  router.push(reelsHref(checked));
                  setOpen(false);
                })
              }
            >
              {loading ? "Načítám…" : "Načíst fotky"}
            </Button>
            <span className="text-caption" role="status">
              {tooMany
                ? `Najednou nejvýš ${MAX_REEL_GALLERIES} alb.`
                : checked.length > 0
                  ? `Vybráno: ${checked.length}`
                  : "Zaškrtni jednu nebo víc svateb či alb."}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
