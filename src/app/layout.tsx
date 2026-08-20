import type { Metadata } from "next";
import { AppAnalytics } from "@/components/analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "g-gallery",
    template: "%s · g-gallery",
  },
  description: "Client photo gallery delivery",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs">
      <body>
        {children}
        <AppAnalytics />
      </body>
    </html>
  );
}
