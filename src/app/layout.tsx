import type { Metadata } from "next";
import { AppAnalytics } from "@/components/analytics";
import { bitterFont } from "@/lib/fonts";
import "./globals.css";

// Production origin (docs/VERCEL-ENV.md) — resolves relative canonical/OG URLs
// declared by individual pages. Not env-driven: there is exactly one deployed
// origin for this app, unlike NEXT_PUBLIC_PHOTOS_BASE_URL (the CDN), which
// legitimately differs between local/preview/production.
export const metadata: Metadata = {
  metadataBase: new URL("https://photos.svatebni-fotograf-cechy.cz"),
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
