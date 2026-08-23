"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [askName, setAskName] = useState(false);
  const [resuming, setResuming] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

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
        onFatal: (rejection) => setFatal(guestRejectionMessage(rejection)),
        onSkipped: (rejection, count) => {
          // Nothing will ever make these acceptable, so they leave the queue
          // rather than being retried on every visit.
          for (const entry of queued) void dequeueUpload(entry.id);
          setFatal(
            count > 1
              ? `${guestRejectionMessage(rejection)} (${count} souborů jsme přeskočili, ostatní nahráváme.)`
              : guestRejectionMessage(rejection),
          );
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
    [onUploaded, token, update],
  );

  const start = useCallback(
    async (files: File[]) => {
      await run(await enqueueUploads(token, files));
    },
    [run, token],
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
      void run(queued).finally(() => setResuming(false));
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

          {running && (
            <div className="mb-2">
              <p className="text-sm">
                {resuming ? "Dokončuji nahrávání" : "Nahrávám"} {done} z {items.length} · displej
                nechám svítit. Kdyby se to přerušilo, dopošle se, až se sem vrátíte.
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
                    Zahodit zbytek
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
              {done > 0 ? "Nahráno. Uvidí to všichni na svatbě." : "Nic se nenahrálo."}
              {failed > 0 && (
                <span className="text-red-600 dark:text-red-400"> · {failed} se nepovedlo</span>
              )}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={running}
              onClick={() => pickRef.current?.click()}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-3 text-base font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Přidat fotky
            </button>
            <button
              type="button"
              disabled={running}
              onClick={() => cameraRef.current?.click()}
              className="rounded-lg border px-4 py-3 text-base font-medium disabled:opacity-50"
            >
              Vyfotit
            </button>
          </div>

          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Nahráním potvrzujete, že fotky můžete sdílet. Nechcete některou v albu?{" "}
            {takedownEmail ? (
              <a href={`mailto:${takedownEmail}`} className="underline">
                Napište nám
              </a>
            ) : (
              "Řekněte novomanželům, smažou ji hned"
            )}
            .
          </p>

          <input
            ref={pickRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => pick(event.target.files)}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(event) => pick(event.target.files)}
          />
        </div>
      </div>

      {askName && <NameAsk onSubmit={submitName} />}
    </>
  );
}

function NameAsk({ onSubmit }: { onSubmit: (name: string) => void }) {
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
        <h2 className="text-lg font-medium">Komu za ně poděkovat?</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Napište křestní jméno — objeví se u vašich fotek. Nechat prázdné je taky v pořádku.
        </p>
        <input
          autoFocus
          value={value}
          maxLength={60}
          onChange={(event) => setValue(event.target.value)}
          className="mt-3 w-full rounded-lg border px-3 py-2 text-base"
          placeholder="Jméno"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Uložit
          </button>
          <button type="button" className="px-4 py-2 underline" onClick={() => onSubmit("")}>
            Přeskočit
          </button>
        </div>
      </form>
    </div>
  );
}

/** Guest-side wording. Every refusal says what happened and what to do next. */
function guestRejectionMessage(rejection: UploadRejection): string {
  switch (rejection.code) {
    case "unsupported_type":
      if (rejection.detail.reason === "heic") {
        return "Tenhle formát (HEIC) zatím neumíme. V Nastavení → Fotoaparát → Formáty přepněte na „Nejkompatibilnější“ a zkuste to znovu.";
      }
      if (rejection.detail.reason === "video") {
        return "Videa zatím nepřijímáme, jen fotky.";
      }
      return "Tenhle typ souboru neumíme. Zkuste jinou fotku.";
    case "file_too_large":
      return "Fotka je moc velká.";
    case "quota_exceeded":
      return rejection.detail.reason === "VIEWER_FULL"
        ? "Máte tu už hodně fotek — víc jich zatím přidat nejde. Díky!"
        : "Album je zatím plné. Dejte prosím vědět novomanželům.";
    case "upload_denied":
      return rejection.detail.reason === "PASSWORD_REQUIRED"
        ? "Načtěte prosím stránku znovu a zadejte heslo."
        : "Album už nové fotky nepřijímá.";
    default:
      return "Nahrávání se nepovedlo. Zkuste to prosím znovu, až budete mít lepší signál.";
  }
}
