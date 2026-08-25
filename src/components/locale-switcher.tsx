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
  const [pending, startTransition] = useTransition();

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

  return (
    <div
      role="group"
      aria-label={`${t("cs")} / ${t("en")}`}
      // The outer pill is un-padded — padding here would shrink each segment
      // below the button below its own 44px, since the two segments share
      // this box's height. `gap-0.5` alone keeps CS/EN visually separated.
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border border-neutral-300 dark:border-neutral-700 ${className ?? ""}`}
    >
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          disabled={pending}
          onClick={() => choose(code)}
          aria-pressed={locale === code}
          // Apple HIG (Buttons): "a button needs a hit region of at least
          // 44x44 pt ... as a general rule" — h-11/min-w-11 here, not on the
          // wrapper, is what actually guarantees it per segment.
          className={`flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-xs font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            locale === code
              ? "bg-brand-primary text-white"
              : "hover:bg-brand-tint hover:text-brand-ink text-neutral-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
