"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { BrandMark, ContactLine, GuestScreen } from "@/components/dead-end";
import { Button } from "@/components/ui/button";

/**
 * The gallery's error boundary — a load that failed rather than a link that is
 * gone, which is why it is the one standalone guest screen that offers a retry
 * (see the "no retry button" rule on `DeadEnd`). Everything else about it is
 * the shared `GuestScreen`: same card, same mark, same footer identity, so a
 * transient failure does not look like a different website.
 */
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
    <GuestScreen>
      <BrandMark />

      <h1 className="text-brand-ink text-title font-semibold text-balance dark:text-neutral-100">
        {t("galleryErrorTitle")}
      </h1>
      <p className="text-body mt-2.5 text-neutral-600 dark:text-neutral-300">
        {t("galleryErrorLead")}
      </p>

      <div className="mt-6 flex justify-center">
        <Button type="button" variant="primary" size="lg" onClick={() => reset()}>
          {t("tryAgain")}
        </Button>
      </div>

      <ContactLine />
    </GuestScreen>
  );
}
