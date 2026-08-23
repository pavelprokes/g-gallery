import type { Metadata } from "next";

// The page itself is "use client" (needs useSearchParams for the post-login
// redirect), so metadata has to live in a wrapping Server Component instead.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: LayoutProps<"/sign-in">) {
  return children;
}
