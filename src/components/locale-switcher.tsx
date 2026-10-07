"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, type Locale } from "@/i18n/locales";
import { LOCALE_STORAGE_KEY } from "@/components/locale-bootstrap";
import { setLocale } from "@/lib/locale-actions";

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("localeSwitcher");
  const router = useRouter();
  const [, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // localStorage can be unavailable (private mode, blocked storage) —
      // the cookie already carries the preference, so this is just a mirror.
    }
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  // A native <select>: seven languages are past what a segmented pill fits on
  // a phone (docs/I18N.md §The switcher), and the platform picker is the
  // accessible, thumb-sized menu every guest already knows. `className` is
  // layout only (margin, alignment).
  return (
    <select
      // Every language by its own name — "Čeština / English / …" — so a screen
      // reader user who speaks only one of them still recognises theirs.
      aria-label={LOCALES.map((code) => t(code)).join(" / ")}
      value={locale}
      onChange={(event) => choose(event.target.value as Locale)}
      // h-11: the 44 px hit region Apple HIG asks for.
      className={`hover:bg-brand-tint hover:text-brand-ink h-11 shrink-0 cursor-pointer rounded-full border border-neutral-300 bg-transparent px-4 text-sm font-semibold text-neutral-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 ${className ?? ""}`}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code} lang={code}>
          {t(code)}
        </option>
      ))}
    </select>
  );
}
