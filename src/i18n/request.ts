import { match } from "@formatjs/intl-localematcher";
import { cookies, headers } from "next/headers";
import Negotiator from "negotiator";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/locales";

export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const preferred = new Negotiator({
    headers: { "accept-language": acceptLanguage },
  }).languages();
  return match(preferred, LOCALES, DEFAULT_LOCALE) as Locale;
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
