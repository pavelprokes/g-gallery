"use client";

import { useEffect } from "react";
import type { Locale } from "@/i18n/locales";
import { LOCALE_COOKIE } from "@/i18n/locales";

export const LOCALE_STORAGE_KEY = "g-gallery-locale";

export function LocaleBootstrap({
  locale,
  persistedByCookie,
}: {
  locale: Locale;
  persistedByCookie: boolean;
}) {
  useEffect(() => {
    if (window.localStorage.getItem(LOCALE_STORAGE_KEY) === null) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
    // First visit: the server only guessed the locale from Accept-Language
    // and cannot set a cookie mid-render — persist it now so the next
    // request renders consistently without renegotiating. A plain
    // document.cookie write, not the setLocale Server Action: the page
    // already rendered with the right language, so there's nothing to
    // re-render — going through a Server Action here would trigger Next's
    // implicit router refresh on every guest's very first page load for no
    // benefit, and can race a redirect() the current route is mid-render on.
    if (!persistedByCookie) {
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    }
  }, [locale, persistedByCookie]);

  return null;
}
