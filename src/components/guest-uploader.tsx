"use client";

import { UploadProgressRing } from "@/components/upload-progress-ring";
import { NameSheet, SHEET_PRIMARY, SHEET_SECONDARY } from "@/components/name-sheet";
import { useTranslations } from "next-intl";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  clearViewerName,
  getOptOutServerSnapshot,
  getOptOutSnapshot,
  getViewerId,
  getViewerName,
  getViewerNameServerSnapshot,
  hasAnsweredUploadName,
  markUploadNameAnswered,
  setViewerName,
  subscribeOptOut,
  subscribeViewerName,
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
//
// The name is asked *before* the file picker, once per browser (Pavel,
// 2026-09-23 — this reverses the earlier "after the first upload" rule, see
// docs/GUEST-GALLERIES.md §6). Asked afterwards, most guests had already put
// the phone away, and the couple ended up with an album of nobody's photos.
// To keep the cost at zero taps, both of the sheet's buttons are themselves
// file inputs: naming yourself and skipping go straight to the picker.

type Source = "library" | "camera";

/** What the name sheet is open for, if anything. */
type SheetMode = { kind: "pick"; source: Source } | { kind: "rename" };

interface Item {
  file: File;
  state: UploadItemState;
  error?: string;
}

export function GuestUploader({
  token,
  onUploaded,
  onRenamed,
}: {
  token: string;
  /** Called once a run added at least one photo, so the grid can refetch. */
  onUploaded: () => void | Promise<void>;
  /** Called after the guest changed their name, so photo credits refetch. */
  onRenamed: () => void | Promise<void>;
}) {
  const t = useTranslations("guestUpload");
  const tRejection = useTranslations("guestUpload.rejection");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /**
   * Where focus goes once the sheet closed on a pick. The bar button that
   * opened it no longer exists at that point — answering swaps it for the
   * file input — so the focus trap's own restore would drop to <body>.
   */
  const sourceInputs = useRef<Record<Source, HTMLInputElement | null>>({
    library: null,
    camera: null,
  });
  const [barHeight, setBarHeight] = useState(0);
  const [draftName, setDraftName] = useState("");
  const name = useSyncExternalStore(
    subscribeViewerName,
    getViewerName,
    getViewerNameServerSnapshot,
  );
  const optedOut = useSyncExternalStore(
    subscribeOptOut,
    getOptOutSnapshot,
    getOptOutServerSnapshot,
  );
  // Client-only component (loaded with `ssr: false`), so reading storage in
  // the initialiser cannot cause a hydration mismatch.
  const [nameAnswered, setNameAnswered] = useState(hasAnsweredUploadName);
  /**
   * A guest who opted out gets no attribution anyway, so asking would be a
   * question whose answer goes nowhere.
   */
  const needsName = !optedOut && !name && !nameAnswered;
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
      // Read now rather than captured: the sheet sets it a moment before this
      // run starts, and a resumed run must carry whatever the guest chose since.
      const credentials = {
        kind: "guest" as const,
        shareToken: token,
        anonKey,
        displayName: anonKey ? getViewerName() : null,
      };

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

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;
  const finished = items.length > 0 && !running;

  /**
   * Saves a changed name and re-credits this guest's photos already here. An
   * empty name takes it back: the credit is public, so it has to be removable.
   */
  const rename = useCallback(
    async (next: string) => {
      setSheet(null);
      if (next) setViewerName(next);
      else clearViewerName();
      markUploadNameAnswered();
      setNameAnswered(true);
      const anonKey = getViewerId();
      if (!anonKey) return;
      try {
        const response = await fetch(`/api/g/${encodeURIComponent(token)}/identify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anonKey, displayName: next || null }),
        });
        if (response.ok) void onRenamed();
      } catch {
        // The name is kept locally either way and rides along with the next
        // upload; this is not worth an error state.
      }
    },
    [onRenamed, token],
  );

  /**
   * The sheet's file inputs. The choice is recorded only once files were
   * actually picked: backing out of the picker leaves the sheet as it was.
   */
  const pickFromSheet = (
    event: ChangeEvent<HTMLInputElement>,
    source: Source,
    withName: boolean,
  ) => {
    const list = Array.from(event.target.files ?? []);
    if (list.length === 0) return;
    requestAnimationFrame(() => sourceInputs.current[source]?.focus({ preventScroll: true }));
    const trimmed = draftName.trim();
    if (withName && trimmed) setViewerName(trimmed);
    markUploadNameAnswered();
    setNameAnswered(true);
    setSheet(null);
    void start(list);
  };

  const openSheet = (mode: SheetMode) => {
    setDraftName(getViewerName() ?? "");
    setSheet(mode);
  };

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) void start(list);
  };

  return (
    <>
      {/* Keeps the fixed bar from covering the end of the page. Measured,
          not guessed: the bar grows with its status lines, and a fixed
          spacer left the footer's last lines underneath it. */}
      <div aria-hidden="true" style={{ height: barHeight || 160 }} />

      <div
        ref={barRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur dark:bg-neutral-950/95"
      >
        <div className="mx-auto max-w-5xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {fatal && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{fatal}</p>}

          {preparing > 0 && (
            <p className="mb-2 flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="motion-loop inline-block size-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100"
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
              <div className="mt-1 flex items-center gap-2">
                <UploadProgressRing done={done} total={items.length} />
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
          {!optedOut && !needsName && !running && preparing === 0 && (
            <p className="text-caption text-brand-ink/60 dark:text-brand-tint/60 mb-2 flex min-w-0 items-center gap-1">
              <span className="truncate">
                {name ? t("uploadingAs", { name }) : t("uploadingAnonymously")}
              </span>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="text-brand-primary dark:text-brand-border -my-3 shrink-0 py-3 font-medium underline-offset-2 hover:underline"
                onClick={() => openSheet({ kind: "rename" })}
              >
                {name ? t("changeName") : t("addName")}
              </button>
            </p>
          )}

          <div className="flex gap-2">
            <SourceButton
              inputRef={(input) => {
                sourceInputs.current.library = input;
              }}
              source="library"
              label={t("addPhotos")}
              primary
              disabled={running}
              asksName={needsName}
              onAsk={() => openSheet({ kind: "pick", source: "library" })}
              onPick={pick}
            />
            <SourceButton
              inputRef={(input) => {
                sourceInputs.current.camera = input;
              }}
              source="camera"
              label={t("takePhoto")}
              disabled={running}
              asksName={needsName}
              onAsk={() => openSheet({ kind: "pick", source: "camera" })}
              onPick={pick}
            />
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

      {sheet?.kind === "pick" && (
        <PickSheet
          source={sheet.source}
          draftName={draftName}
          onDraftChange={setDraftName}
          onPick={pickFromSheet}
          onDismiss={() => setSheet(null)}
        />
      )}

      {sheet?.kind === "rename" && (
        <NameSheet
          title={t("nameSheetTitle")}
          hint={t("renameHint")}
          placeholder={t("nameSheetPlaceholder")}
          value={draftName}
          onChange={setDraftName}
          onSubmit={() => {
            const trimmed = draftName.trim();
            // Clearing a name nobody had is not a change worth a request.
            if (trimmed || name) void rename(trimmed);
            else setSheet(null);
          }}
          onDismiss={() => setSheet(null)}
        >
          <button type="submit" className={SHEET_PRIMARY}>
            {name && !draftName.trim() ? t("renameRemove") : t("renameSave")}
          </button>
          <button type="button" className={SHEET_SECONDARY} onClick={() => setSheet(null)}>
            {t("renameCancel")}
          </button>
        </NameSheet>
      )}
    </>
  );
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * "Přidat fotky" / "Vyfotit" in the bar. Normally the button *is* the file
 * input, stretched over it at zero opacity, rather than a real button calling
 * input.click() on a hidden input: iOS Safari refuses to open the picker for an
 * input that is display:none, so that version did nothing at all on an iPhone —
 * the one device this bar exists for. While the name is still to be asked it
 * is a plain button that opens the sheet instead, whose own buttons are inputs.
 */
function SourceButton({
  inputRef,
  source,
  label,
  primary = false,
  disabled,
  asksName,
  onAsk,
  onPick,
}: {
  inputRef: (input: HTMLInputElement | null) => void;
  source: Source;
  label: string;
  primary?: boolean;
  disabled: boolean;
  asksName: boolean;
  onAsk: () => void;
  onPick: (files: FileList | null) => void;
}) {
  const className = `relative flex min-h-12 items-center justify-center rounded-lg px-4 text-base transition-colors duration-flip focus-visible:outline-2 focus-visible:outline-offset-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 ${
    primary
      ? "bg-brand-primary hover:bg-brand-primary-dark flex-1 font-semibold text-white"
      : "border font-medium"
  } ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`;

  if (asksName) {
    return (
      <button type="button" disabled={disabled} className={className} onClick={onAsk}>
        {label}
      </button>
    );
  }

  return (
    <label className={className}>
      {label}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        {...(source === "camera" ? { capture: "environment" as const } : { multiple: true })}
        disabled={disabled}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => onPick(event.target.files)}
      />
    </label>
  );
}

/**
 * The first-time sheet. Both actions are file inputs (see {@link SourceButton})
 * so that naming yourself, or declining to, costs no tap beyond the one that
 * opens the picker. Enter in the field opens the picker too, through the
 * primary input — a trusted key event is a user gesture, which is what the
 * picker requires.
 */
function PickSheet({
  source,
  draftName,
  onDraftChange,
  onPick,
  onDismiss,
}: {
  source: Source;
  draftName: string;
  onDraftChange: (value: string) => void;
  onPick: (event: ChangeEvent<HTMLInputElement>, source: Source, withName: boolean) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("guestUpload");
  const primaryInputRef = useRef<HTMLInputElement>(null);
  const inputProps = {
    type: "file" as const,
    accept: ACCEPT,
    ...(source === "camera" ? { capture: "environment" as const } : { multiple: true }),
    className: "absolute inset-0 h-full w-full cursor-pointer opacity-0",
  };
  const primaryLabel = source === "camera" ? t("takePhoto") : t("nameSheetPickPhotos");

  return (
    <NameSheet
      title={t("nameSheetTitle")}
      hint={t("nameSheetHint")}
      placeholder={t("nameSheetPlaceholder")}
      value={draftName}
      onChange={onDraftChange}
      onSubmit={() => primaryInputRef.current?.click()}
      onDismiss={onDismiss}
    >
      <label className={SHEET_PRIMARY}>
        {primaryLabel}
        <input
          ref={primaryInputRef}
          {...inputProps}
          aria-label={primaryLabel}
          onChange={(event) => onPick(event, source, true)}
        />
      </label>
      <label className={SHEET_SECONDARY}>
        {t("nameSheetSkip")}
        <input
          {...inputProps}
          aria-label={t("nameSheetSkip")}
          onChange={(event) => onPick(event, source, false)}
        />
      </label>
    </NameSheet>
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
