"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "@/lib/auth-client";

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">g-gallery</h1>
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => void signIn.social({ provider: "google", callbackURL: next })}
        >
          Přihlásit se přes Google
        </button>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
