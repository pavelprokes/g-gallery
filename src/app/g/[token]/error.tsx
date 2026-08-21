"use client";

import { useEffect } from "react";

export default function GalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold">Něco se pokazilo</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Galerii se nepodařilo načíst. Zkus to prosím znovu.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Zkusit znovu
        </button>
      </div>
    </main>
  );
}
