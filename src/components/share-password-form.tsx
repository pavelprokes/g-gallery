"use client";

import { useActionState } from "react";
import { unlockShareLink, type UnlockState } from "@/app/g/[token]/actions";

export function SharePasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockShareLink, {});

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <form action={action} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Galerie je chráněná heslem</h1>
          <p className="mt-1 text-sm text-neutral-500">Heslo ti poslal fotograf spolu s odkazem.</p>
        </div>

        <input type="hidden" name="token" value={token} />
        <input
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="w-full rounded border px-3 py-2"
          placeholder="Heslo"
        />

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Ověřuji…" : "Zobrazit galerii"}
        </button>
      </form>
    </main>
  );
}
