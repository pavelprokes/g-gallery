"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

/**
 * The first sign-out control in the app — `signOut` was exported and never
 * called anywhere.
 *
 * The redirect has to be explicit: src/proxy.ts only intervenes on a
 * *navigation* to /admin/*, and after signOut the browser is still sitting on
 * an already-rendered admin page. `router.refresh()` after the redirect drops
 * the Router Cache's copy of that tree — without it, Back would show the
 * signed-out portal from memory.
 *
 * Target is /sign-in with no `?next=` on purpose: signing out deliberately
 * should not spring back into the admin on the next login.
 */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="text-admin-muted hover:text-admin-danger text-sm font-semibold transition-colors disabled:opacity-55"
      onClick={async () => {
        setPending(true);
        try {
          await signOut();
          router.replace("/sign-in");
          router.refresh();
        } catch {
          // The session cookie is still valid, so the portal still works —
          // re-enable the button rather than stranding the user on a dead one.
          setPending(false);
        }
      }}
    >
      {pending ? "Odhlašuji…" : "Odhlásit"}
    </button>
  );
}
