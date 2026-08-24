"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function GalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold">{t("galleryErrorTitle")}</h1>
        <p className="mt-2 text-sm text-neutral-500">{t("galleryErrorLead")}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          {t("tryAgain")}
        </button>
      </div>
    </main>
  );
}
