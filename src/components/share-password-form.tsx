"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId } from "react";
import { unlockShareLink, type UnlockState } from "@/app/g/[token]/actions";
import { BrandMark, GuestScreen } from "@/components/dead-end";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/**
 * The password gate — for a protected link, the very first screen a paying
 * client ever sees of the gallery they bought.
 *
 * It therefore uses the same shell as every other standalone guest screen
 * (`GuestScreen`) rather than the hand-rolled bordered input and black button
 * it used to carry, which read as a login to an admin panel.
 *
 * The one hard constraint on the copy: **nothing here may identify the
 * gallery.** `resolveShareLink` returns `PASSWORD_REQUIRED` without unlocking
 * anything, and the route's `generateMetadata` deliberately falls back to a
 * neutral placeholder for exactly this case — so the couple's names, the
 * gallery title and the photo count are all off limits until the password is
 * right. What the screen *can* say is whose product this is: the photographer's
 * own mark and name reveal nothing about who the gallery belongs to, and they
 * are the difference between "is this a phishing page?" and "this is the
 * gallery Pavel sent us".
 *
 * The wrong-password message is left exactly as translated: it is vague about
 * *why* the attempt failed on purpose, because the same string also covers the
 * rate-limited lockout in `src/app/g/[token]/actions.ts`.
 */
export function SharePasswordForm({ token }: { token: string }) {
  const t = useTranslations("sharePassword");
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockShareLink, {});
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  return (
    <GuestScreen>
      <BrandMark />

      <p className="text-caption text-admin-muted tracking-wide dark:text-neutral-400">
        {t("eyebrow")}
      </p>
      <h1 className="text-brand-ink text-title mt-1 font-semibold text-balance dark:text-neutral-100">
        {t("title")}
      </h1>
      <p className="text-body mt-2.5 text-neutral-600 dark:text-neutral-300">{t("hint")}</p>

      <form action={action} className="mt-6 space-y-4 text-left">
        <input type="hidden" name="token" value={token} />

        <div>
          <Label htmlFor={fieldId}>{t("passwordLabel")}</Label>
          <Input
            id={fieldId}
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
          />
        </div>

        {/* `role="alert"` rather than a bare paragraph: the server action
            re-renders in place, so without it a screen-reader user gets no
            signal at all that the attempt failed. */}
        {state.error && (
          <Alert id={errorId} tone="danger" role="alert">
            {state.error}
          </Alert>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
          {pending ? t("verifying") : t("submit")}
        </Button>
      </form>
    </GuestScreen>
  );
}
