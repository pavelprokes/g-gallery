import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppAnalytics } from "@/components/analytics";
import { LocaleBootstrap } from "@/components/locale-bootstrap";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { bitterFont } from "@/lib/fonts";
import { SITE_ORIGIN } from "@/lib/site-url";
import "./globals.css";

/**
 * `viewport-fit=cover` is what makes every `env(safe-area-inset-*)` in the app
 * resolve to a real number. Without it they are all `0`, and the lightbox's
 * bottom bar sits under the iPhone home indicator while the nav buttons sit
 * under the notch in landscape — silently, since the CSS is present and simply
 * computes to zero. Next's default viewport does not include it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The couple sees this in their browser tab and in the link preview when they
 * forward the gallery to eighty people. "g-gallery" is this repository's name,
 * not a thing a client has ever heard of, and the old English description was
 * a developer's one-liner — both were leaking into a wedding present.
 *
 * The guest surfaces override the title *absolutely* (`title: { absolute }` in
 * their own `generateMetadata`), so a gallery's tab reads "Pavel a Patricie"
 * and nothing else; the template below decorates only the app's own pages.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "Pavel Prokeš — svatební fotograf",
    template: "%s · Pavel Prokeš",
  },
  description: "Svatební fotografie na jednom odkazu.",
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
