import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// Icons mirror svatebni-fotograf-cechy-2.0/public/favicon (Pavel's main site) — see
// src/app/favicon.ico / icon.png / apple-icon.png for the browser-tab/bookmark set,
// which Next picks up automatically by filename convention.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("manifest");
  return {
    name: t("name"),
    short_name: "g-gallery",
    description: t("description"),
    start_url: "/",
    display: "standalone",
    background_color: "#fdf8f5",
    theme_color: "#825238",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
