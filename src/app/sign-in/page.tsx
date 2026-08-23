"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";

  return (
    <main className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-2xl font-semibold">g-gallery</h1>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => void signIn.social({ provider: "google", callbackURL: next })}
        >
          Přihlásit se přes Google
        </Button>
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
