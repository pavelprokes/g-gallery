"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ADMIN_FILTERS,
  ADMIN_SORTS,
  adminViewQuery,
  DEFAULT_VIEW,
  isFiltered,
  toggleAdminFilter,
  type AdminFilter,
  type AdminSort,
  type AdminView,
} from "@/lib/admin-photo-filters";
import { FORMS, pluralize } from "@/lib/czech-plural";

// The admin grid's filters (docs/ADMIN-FILTERS.md). Every choice is a URL —
// chips are links, client-side so a running upload is not interrupted — so a
// view is bookmarked, shared and undone with the browser's Back like any page.

const FILTER_LABEL: Record<AdminFilter, string> = {
  comments: "✎ Připomínky",
  print: "🖨 K tisku",
  favorites: "♥ Srdíčka",
  reactions: "Reakce",
  viewed: "Zobrazené",
  highlights: "★ Výběr dne",
  "video-draft": "Ve videu pro sítě",
  tagged: "S označenými lidmi",
  untagged: "Bez označení",
  guests: "Od hostů",
  videos: "▶ Videa",
  details: "Detaily",
};

const SORT_LABEL: Record<AdminSort, string> = {
  loved: "Nejoblíbenější",
  views: "Nejprohlíženější",
  viewers: "Nejvíc diváků",
  order: "Pořadí a kapitoly",
  name: "Podle názvu",
};

const chip = (active: boolean) =>
  `inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
    active
      ? "border-brand-primary bg-brand-tint text-brand-primary-dark"
      : "border-admin-border hover:border-brand-primary hover:text-brand-primary text-brand-primary-dark bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
  }`;

export function AdminFilterBar({
  view,
  counts,
  shown,
  total,
  people,
  chapters,
}: {
  view: AdminView;
  counts: Record<AdminFilter, number>;
  shown: number;
  total: number;
  people: { id: string; name: string }[];
  chapters: { id: string; title: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(view.q);
  const go = (next: AdminView) => router.push(`${pathname}${adminViewQuery(next)}`);

  return (
    <div className="mt-3 space-y-2" aria-label="Filtry fotek" role="group">
      <div className="flex flex-wrap gap-1.5">
        {ADMIN_SORTS.map((sort) => (
          <Link
            key={sort}
            href={pathname + adminViewQuery({ ...view, sort })}
            aria-current={view.sort === sort ? "true" : undefined}
            className={chip(view.sort === sort)}
          >
            {SORT_LABEL[sort]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ADMIN_FILTERS.map((filter) => {
          const active = view.filters.includes(filter);
          // A filter nothing would pass is noise — unless it is the one on.
          if (!active && counts[filter] === 0) return null;
          return (
            <Link
              key={filter}
              href={pathname + adminViewQuery(toggleAdminFilter(view, filter))}
              aria-current={active ? "true" : undefined}
              className={chip(active)}
            >
              {FILTER_LABEL[filter]}
              <span className="tabular-nums opacity-70">{counts[filter]}</span>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {people.length > 0 && (
          <select
            aria-label="Označená osoba"
            value={view.person ?? ""}
            onChange={(event) => go({ ...view, person: event.target.value || null })}
            className="border-admin-border min-h-8 rounded-full border bg-white px-3 text-xs max-sm:w-full dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Kdokoli z označených</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
        {chapters.length > 0 && (
          <select
            aria-label="Kapitola"
            value={view.chapter ?? ""}
            onChange={(event) => go({ ...view, chapter: event.target.value || null })}
            className="border-admin-border min-h-8 rounded-full border bg-white px-3 text-xs max-sm:w-full dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Všechny kapitoly</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
        )}
        <form
          role="search"
          className="flex items-center gap-1 max-sm:w-full"
          onSubmit={(event) => {
            event.preventDefault();
            go({ ...view, q: q.trim() });
          }}
        >
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            aria-label="Hledat podle názvu souboru"
            placeholder="Název, např. PPR55013"
            // 16 px on phones: iOS zooms into anything smaller.
            className="border-admin-border min-h-8 w-48 rounded-full border bg-white px-3 text-base max-sm:flex-1 sm:text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
        </form>
        <p className="text-admin-muted text-xs tabular-nums dark:text-neutral-400">
          {shown === total ? pluralize(total, FORMS.photo) : `${shown} z ${total} fotek`}
        </p>
        {isFiltered(view) && (
          <Link
            href={pathname + adminViewQuery({ ...DEFAULT_VIEW, sort: view.sort })}
            className="text-brand-primary inline-flex min-h-8 items-center px-1 text-xs font-semibold underline"
          >
            Zrušit filtry
          </Link>
        )}
      </div>
    </div>
  );
}
