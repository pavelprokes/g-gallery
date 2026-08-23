import type { Metadata } from "next";

// Every /admin/* page is auth-gated and has nothing to say to a search
// engine — explicit noindex here, rather than relying on Next's index/follow
// default, matches the same policy already set on /g/* and /s/*.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
