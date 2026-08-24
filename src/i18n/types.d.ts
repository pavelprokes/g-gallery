import type { Locale } from "@/i18n/locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
  }
}
