import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppAnalytics } from "@/components/analytics";
import { LocaleBootstrap } from "@/components/locale-bootstrap";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { bitterFont } from "@/lib/fonts";
import { SITE_ORIGIN } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "g-gallery",
    template: "%s · g-gallery",
  },
  description: "Client photo gallery delivery",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  const persistedByCookie = Boolean((await cookies()).get(LOCALE_COOKIE));

  return (
    <html lang={locale}>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject
          attributes like cz-shortcut-listen onto <body> before React
          hydrates — a false-positive mismatch React can't avoid on its own. */}
      <body className={bitterFont.variable} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LocaleBootstrap locale={locale} persistedByCookie={persistedByCookie} />
          {children}
          <AppAnalytics />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
