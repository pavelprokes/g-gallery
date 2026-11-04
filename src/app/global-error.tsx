"use client";

import { useEffect } from "react";
import { BrandMark } from "@/components/dead-end";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { bitterFont } from "@/lib/fonts";
import "./globals.css";

/**
 * Last resort: an error in the root layout itself, which no route's `error.tsx`
 * can catch. It replaces the root layout, so it renders its own `<html>` and
 * `<body>` and has none of the layout's providers — in particular no
 * `NextIntlClientProvider`, so no catalog and no idea of the guest's locale.
 * Hence the two fixed languages: Czech for the couple and their families, and
 * English for everyone else. Kept deliberately small (no footer identity, no
 * contact line — both read from providers that are not here).
 *
 * `retry` re-fetches and re-renders (Next 16.3 docs, error.md); `reset` would
 * re-render the same failed payload.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="cs">
      <body className={bitterFont.variable}>
        <title>Něco se pokazilo · Something went wrong</title>
        <main className="font-brand flex min-h-dvh flex-col items-center justify-center p-6">
          <Card className="w-full max-w-sm p-8 text-center">
            <BrandMark />
            <h1 className="text-brand-ink text-title font-semibold text-balance dark:text-neutral-100">
              Něco se pokazilo
            </h1>
            <p className="text-body mt-2.5 text-neutral-600 dark:text-neutral-300">
              Stránku se nepodařilo načíst. Zkus to prosím znovu.
            </p>
            <p
              lang="en"
              className="text-body mt-4 border-t pt-4 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
            >
              Something went wrong and the page could not be loaded. Please try again.
            </p>
            <div className="mt-6 flex justify-center">
              <Button type="button" variant="primary" size="lg" onClick={() => retry()}>
                Zkusit znovu · Try again
              </Button>
            </div>
          </Card>
        </main>
      </body>
    </html>
  );
}
