// Split out from request.ts (which imports next/headers) so client
// components can import the locale vocabulary without pulling a
// server-only module into the browser bundle.
export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";
export const LOCALE_COOKIE = "NEXT_LOCALE";
