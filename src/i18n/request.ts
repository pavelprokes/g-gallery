import { match } from "@formatjs/intl-localematcher";
import { cookies, headers } from "next/headers";
import Negotiator from "negotiator";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/locales";

/**
 * Which language to render in, from an `Accept-Language` header.
 *
 * `Negotiator` hands back whatever the client asked for, including the
 * wildcard `*` — which RFC 9110 explicitly allows and which Node's own `fetch`
 * sends by default. `@formatjs/intl-localematcher` then throws
 * `RangeError: Incorrect locale information provided` on it, because `*` is not
 * a BCP-47 tag. That threw during render, so **every page of the site returned
 * 500** to any client sending it: the gallery, the wedding pages, the home
 * page, even the not-found page. Found 2026-09-03 only because a verification
 * script happened to use `fetch` instead of `curl`.
 *
 * So: drop anything that is not a well-formed tag before matching, and treat a
 * throw as "use the default" rather than as a broken page. A header this app
 * does not understand is a reason to fall back to Czech, never a reason to
 * serve nothing.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const preferred = new Negotiator({
    headers: { "accept-language": acceptLanguage },
  })
    .languages()
    // `*` is the wildcard, not a language; `Intl` rejects it. Anything else
    // malformed goes the same way rather than being handed to a parser that
    // answers with an exception.
    .filter((tag) => tag !== "*" && isStructurallyValidTag(tag));

  if (preferred.length === 0) return DEFAULT_LOCALE;

  try {
    return match(preferred, LOCALES, DEFAULT_LOCALE) as Locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Cheap BCP-47 shape check — `Intl` is the authority, this just keeps the
 * obviously-wrong away from it. */
function isStructurallyValidTag(tag: string): boolean {
  try {
    new Intl.Locale(tag);
    return true;
  } catch {
    return false;
  }
}

function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie)
    ? fromCookie
    : negotiateLocale((await headers()).get("accept-language"));

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
