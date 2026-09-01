"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { adoptViewerId, getViewerId } from "@/lib/viewer-id";
import { formatTransferCode } from "@/lib/viewer-transfer";

type Mode = "idle" | "showing" | "entering";

/**
 * "Continue on another device" (docs/PLAN.md §8a).
 *
 * The bride goes through 700 photos on her phone across three evenings, then
 * they sit down at the laptop together to finish and the laptop shows nothing;
 * her mother, who wants six prints, is on a third device. Favourites, reactions
 * and print marks all hang off a `Viewer` keyed by a localStorage `anonKey`, so
 * without this the album selection cannot leave the browser it started in.
 *
 * Deliberately not an account. A code read across a kitchen table moves one
 * viewer inside one gallery, and asks for no email, no password and no name
 * that was not already volunteered.
 *
 * Lives in the gallery footer rather than the toolbar: it is a thing you go
 * looking for once, not a control you want on screen while browsing photos.
 */
export function ViewerTransferPanel({ token }: { token: string }) {
  const t = useTranslations("gallery.transfer");
  const fieldId = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [entered, setEntered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function mint() {
    const anonKey = getViewerId();
    if (!anonKey) {
      setError(t("errorNoIdentity"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/g/${encodeURIComponent(token)}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonKey }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const reason =
          body && typeof body === "object" && "error" in body ? String(body.error) : "";
        // The one refusal worth its own words: there is nothing to move yet,
        // which is a different situation from something going wrong.
        setError(reason === "NOTHING_TO_TRANSFER" ? t("errorNothingYet") : t("errorGeneric"));
        return;
      }
      const data = (await response.json()) as { code: string };
      setCode(data.code);
      setMode("showing");
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/g/${encodeURIComponent(token)}/transfer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: entered }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const reason =
          body && typeof body === "object" && "error" in body ? String(body.error) : "";
        setError(reason === "CODE_EXPIRED" ? t("errorExpired") : t("errorWrongCode"));
        return;
      }
      const data = (await response.json()) as { anonKey: string; displayName: string | null };
      if (!adoptViewerId(data.anonKey, data.displayName)) {
        setError(t("errorNoIdentity"));
        return;
      }
      setDone(true);
      // A full reload rather than refetching in place: favourites, reactions,
      // print marks and "my uploads" are each seeded from their own request at
      // mount, and re-running all of them by hand is more code than a reload
      // and would still miss the next one somebody adds.
      window.location.reload();
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => void mint()}
          disabled={busy}
          className="text-brand-primary-dark underline underline-offset-4 disabled:opacity-50 dark:text-neutral-300"
        >
          {t("startTitle")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("entering");
            setError(null);
          }}
          className="text-brand-primary-dark underline underline-offset-4 dark:text-neutral-300"
        >
          {t("haveCode")}
        </button>
        {error && (
          <span role="alert" className="text-admin-danger w-full">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (mode === "showing") {
    return (
      <div className="border-brand-border max-w-sm rounded-lg border p-3 dark:border-neutral-700">
        <p className="text-brand-ink font-semibold dark:text-neutral-100">{t("codeTitle")}</p>
        <p
          className="text-title my-2 font-semibold tracking-[0.12em] tabular-nums"
          // A code is read aloud or copied by hand, so it gets to be the
          // biggest thing in the panel.
        >
          {code ? formatTransferCode(code.replace("-", "")) : ""}
        </p>
        <p className="text-caption text-neutral-600 dark:text-neutral-400">{t("codeHint")}</p>
        <button
          type="button"
          onClick={() => setMode("idle")}
          className="text-caption text-brand-primary-dark mt-2 underline underline-offset-4 dark:text-neutral-300"
        >
          {t("close")}
        </button>
      </div>
    );
  }

  return (
    <div className="border-brand-border max-w-sm rounded-lg border p-3 dark:border-neutral-700">
      <label htmlFor={fieldId} className="text-brand-ink font-semibold dark:text-neutral-100">
        {t("enterTitle")}
      </label>
      <p className="text-caption mt-0.5 text-neutral-600 dark:text-neutral-400">{t("enterHint")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={fieldId}
          value={entered}
          onChange={(event) => setEntered(event.target.value)}
          // A code is typed once, in caps, and never autocorrected into
          // something else — every one of these attributes is there because a
          // phone keyboard would otherwise fight it.
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="K7P2-M9XQ"
          aria-invalid={error !== null}
          className="border-brand-border min-h-11 flex-1 rounded-lg border px-3 tracking-[0.12em] uppercase dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => void redeem()}
          disabled={busy || done || entered.trim().length === 0}
          className="bg-brand-primary hover:bg-brand-primary-dark duration-flip min-h-11 rounded-lg px-4 font-semibold text-white transition-colors disabled:opacity-50"
        >
          {done ? t("adopted") : t("submit")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-caption text-admin-danger mt-2">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setMode("idle");
          setError(null);
        }}
        className="text-caption text-brand-primary-dark mt-2 underline underline-offset-4 dark:text-neutral-300"
      >
        {t("close")}
      </button>
    </div>
  );
}
