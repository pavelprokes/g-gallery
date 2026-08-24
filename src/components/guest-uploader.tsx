"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  dismissNamePrompt,
  getViewerId,
  getViewerName,
  hasAnsweredNamePrompt,
  setViewerName,
} from "@/lib/viewer-id";
import { matchResumeTargets } from "@/lib/upload-resume";
import {
  clearQueuedUploads,
  dequeueUpload,
  enqueueUploads,
  listQueuedUploads,
} from "@/lib/upload-queue";
import { holdScreenAwake } from "@/lib/wake-lock";
import {
  fetchPendingUploads,
  runUploads,
  UploadRejection,
  type UploadItemState,
} from "@/lib/upload-run";

// The guest half of the upload path (docs/GUEST-GALLERIES.md §6). Same
// transport as the photographer's uploader — presigned PUT straight to R2, no
// bytes through Vercel — authorised by the share token instead of a session.
//
// The bar is fixed to the bottom of the viewport because that is where a thumb
// reaches on a phone held one-handed at a wedding, which is the only device
// this surface is designed for.

interface Item {
  file: File;
  state: UploadItemState;
  error?: string;
}

export function GuestUploader({
  token,
  onUploaded,
}: {
  token: string;
  /** Called once a run added at least one photo, so the grid can refetch. */
  onUploaded: () => void | Promise<void>;
}) {
  const t = useTranslations("guestUpload");
  const tRejection = useTranslations("guestUpload.rejection");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [resuming, setResuming] = useState(false);
  /**
   * How many files are being written to the queue before the first byte moves.
   * Storing forty photos in IndexedDB takes real time, and without this the
   * bar sat silent through it — indistinguishable from nothing happening.
   */
  const [preparing, setPreparing] = useState(0);

  // GDPR take-down route (docs/GUEST-GALLERIES.md §10). Read from the
  // environment rather than hard-coded: an address invented here would be a
  // promise the deployment cannot keep. Without it the copy points at the
  // couple, who can delete a photo themselves, so the route still exists.
  const takedownEmail = process.env.NEXT_PUBLIC_TAKEDOWN_EMAIL;

  const update = useCallback((index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  /**
   * Runs a set of already-queued entries. Each one is removed from the queue
   * the moment it lands, so an interrupted run resumes with exactly what is
   * left rather than starting over.
   */
  const run = useCallback(
    async (queued: { id: string; file: File }[]) => {
      const files = queued.map((entry) => entry.file);
      setItems(files.map((file) => ({ file, state: "pending" as const })));
      setFatal(null);
      setRunning(true);

      // Removes the commonest cause of a dead upload: the display timing out
      // while the phone lies on a table. Best-effort — never depended on.
      const wakeLock = await holdScreenAwake();

      const anonKey = getViewerId();
      const credentials = { kind: "guest" as const, shareToken: token, anonKey };

      // Fetched here rather than on mount: most people who open the gallery
      // never upload anything, and 80 guests each firing a lookup they will
      // not use is a request per page view for nothing. It is also what makes
      // a resumed run re-use its half-finished rows instead of duplicating.
      const resumeIds = matchResumeTargets(files, await fetchPendingUploads(credentials));

      let landed = 0;
      await runUploads({
        files,
        credentials,
        resumeIds,
        onItem: (index, patch) => {
          if (patch.state === "done") {
            landed += 1;
            const entry = queued[index];
            if (entry) void dequeueUpload(entry.id);
          }
          update(index, patch);
        },
        onFatal: (rejection) => setFatal(guestRejectionMessage(rejection, tRejection)),
        onSkipped: (rejection, count) => {
          // Nothing will ever make these acceptable, so they leave the queue
          // rather than being retried on every visit.
          for (const entry of queued) void dequeueUpload(entry.id);
          const message = guestRejectionMessage(rejection, tRejection);
          setFatal(count > 1 ? `${message} ${t("skippedNote", { count })}` : message);
        },
      });

      wakeLock?.release();
      setRunning(false);
      if (landed > 0) {
        // Photos are only visible once the server flipped them to CONFIRMED,
        // so the grid is stale until it refetches.
        void onUploaded();
        // Asked only once, and only after photos actually landed — never
        // before, when the one thing between a guest and their upload should
        // be the file picker.
        if (!hasAnsweredNamePrompt() && anonKey) setAskName(true);
      }
    },
    [onUploaded, t, tRejection, token, update],
  );

  const start = useCallback(
    async (files: File[]) => {
      setFatal(null);
      setPreparing(files.length);
      try {
        const queued = await enqueueUploads(token, files);
        setPreparing(0);
        await run(queued);
      } catch (error) {
        // Nothing may ever fail silently here. A guest who picked a photo and
        // saw the bar go back to how it was has no idea whether it worked, and
        // the honest answer is that it did not.
        console.error("[g-gallery/upload] could not start:", error);
        setFatal(t("startFailed"));
        setRunning(false);
      } finally {
        setPreparing(0);
      }
    },
    [run, t, token],
  );

  /**
   * Anything left from a previous visit finishes on its own. The files are in
   * IndexedDB, so this works even when the page was discarded entirely and the
   * File objects are long gone from memory — which is the whole point of the
   * queue (docs/GUEST-GALLERIES.md §11, F3).
   */
  useEffect(() => {
    let cancelled = false;
    void listQueuedUploads(token).then((queued) => {
      if (cancelled || queued.length === 0) return;
      setResuming(true);
      void run(queued)
        .catch((error: unknown) => {
          console.error("[g-gallery/upload] could not resume:", error);
          setFatal(t("resumeFailed"));
        })
        .finally(() => setResuming(false));
    });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the token alone: this must fire once per gallery,
    // not again every time `run` is recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;
  const finished = items.length > 0 && !running;

  const submitName = useCallback(
    async (name: string) => {
      setAskName(false);
      if (!name) {
        dismissNamePrompt();
        return;
      }
      setViewerName(name);
      const anonKey = getViewerId();
      if (!anonKey) return;
      try {
        await fetch(`/api/g/${encodeURIComponent(token)}/identify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anonKey, displayName: name }),
        });
      } catch {
        // The name is kept locally either way; this is not worth an error state.
      }
    },
    [token],
  );

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) void start(list);
  };

  return (
    <>
      {/* Keeps the fixed bar from covering the last row of the grid. */}
      <div aria-hidden="true" className="h-24" />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur dark:bg-neutral-950/95">
        <div className="mx-auto max-w-5xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {fatal && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{fatal}</p>}

          {preparing > 0 && (
            <p className="mb-2 flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block size-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100"
              />
              {t("preparing", { count: preparing })}
            </p>
          )}

          {running && (
            <div className="mb-2">
              <p className="text-sm">
                {resuming
                  ? t("resumingProgress", { done, total: items.length })
                  : t("uploadingProgress", { done, total: items.length })}
                {resuming && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      // Stops it coming back on the next visit. Requests
                      // already in flight finish — there is nothing to gain
                      // from abandoning bytes that are nearly there.
                      void clearQueuedUploads(token);
                      setResuming(false);
                    }}
                  >
                    {t("discardRest")}
                  </button>
                )}
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
                  style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {finished && !fatal && (
            <p className="mb-2 text-sm">
              {done > 0 ? t("doneSome") : t("doneNone")}
              {failed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {" "}
                  · {t("failedSuffix", { count: failed })}
                </span>
              )}
            </p>
          )}

          {/*
            The file input *is* the button, stretched over it at zero opacity,
            rather than a real button calling input.click() on a hidden input.
            iOS Safari refuses to open the picker for an input that is
            display:none, so the previous version did nothing at all on an
            iPhone — the one device this bar exists for. Tapping here taps the
            input itself, which every browser handles natively.
          */}
          <div className="flex gap-2">
            <label
              className={`relative flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-center text-base font-medium text-white dark:bg-neutral-100 dark:text-neutral-900 ${
                running ? "pointer-events-none opacity-50" : "cursor-pointer"
              }`}
            >
              {t("addPhotos")}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={running}
                aria-label={t("addPhotos")}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(event) => pick(event.target.files)}
              />
            </label>
            <label
              className={`relative rounded-lg border px-4 py-3 text-base font-medium ${
                running ? "pointer-events-none opacity-50" : "cursor-pointer"
              }`}
            >
              {t("takePhoto")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={running}
                aria-label={t("takePhoto")}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(event) => pick(event.target.files)}
              />
            </label>
          </div>

          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t("consentPrefix")}{" "}
            {takedownEmail ? (
              <a href={`mailto:${takedownEmail}`} className="underline">
                {t("consentEmailLinkText")}
              </a>
            ) : (
              t("consentNoEmailFallback")
            )}
            .
          </p>
        </div>
      </div>

      {askName && <NameAsk onSubmit={submitName} />}
    </>
  );
}

function NameAsk({ onSubmit }: { onSubmit: (name: string) => void }) {
  const t = useTranslations("guestUpload");
  const [value, setValue] = useState(() => getViewerName() ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <form
        className="w-full max-w-sm rounded-xl bg-white p-5 dark:bg-neutral-900"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value.trim());
        }}
      >
        <h2 className="text-lg font-medium">{t("nameAskTitle")}</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("nameAskHint")}</p>
        <input
          autoFocus
          value={value}
          maxLength={60}
          onChange={(event) => setValue(event.target.value)}
          className="mt-3 w-full rounded-lg border px-3 py-2 text-base"
          placeholder={t("nameAskPlaceholder")}
        />
        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {t("nameAskSave")}
          </button>
          <button type="button" className="px-4 py-2 underline" onClick={() => onSubmit("")}>
            {t("nameAskSkip")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Guest-side wording. Every refusal says what happened and what to do next. */
function guestRejectionMessage(
  rejection: UploadRejection,
  t: ReturnType<typeof useTranslations<"guestUpload.rejection">>,
): string {
  switch (rejection.code) {
    case "unsupported_type":
      if (rejection.detail.reason === "heic") return t("unsupportedHeic");
      if (rejection.detail.reason === "video") return t("unsupportedVideo");
      return t("unsupportedGeneric");
    case "file_too_large":
      return t("fileTooLarge");
    case "quota_exceeded":
      return rejection.detail.reason === "VIEWER_FULL" ? t("quotaViewerFull") : t("quotaAlbumFull");
    case "upload_denied":
      return rejection.detail.reason === "PASSWORD_REQUIRED"
        ? t("deniedPasswordRequired")
        : t("deniedGeneric");
    case "rate_limited":
      return t("rateLimited");
    case "size_mismatch":
      return t("sizeMismatch");
    default:
      return t("genericFailure");
  }
}
