import type { Metadata } from "next";
import { AppAnalytics } from "@/components/analytics";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs">
      <body className={bitterFont.variable}>
        {children}
        <AppAnalytics />
      </body>
    </html>
  );
}
