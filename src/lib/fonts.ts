import { Bitter } from "next/font/google";

// Brand font for guest-facing surfaces (gallery, lightbox, guest upload, wedding hub) —
// mirrors svatebni-fotograf-cechy-2.0/lib/fonts.ts so the client-facing brand matches the
// main site. Deliberately NOT applied to /admin or /sign-in — those keep the system sans-serif
// stack for data density/legibility, same split the main site's own admin portal uses
// (svatebni-fotograf-cechy-2.0/components/Admin/ui.ts).
export const bitterFont = Bitter({
  variable: "--font-bitter",
  subsets: ["latin", "latin-ext"],
  style: "normal",
});
