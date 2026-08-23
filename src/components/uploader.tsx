"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchResumeTargets, type PendingUpload } from "@/lib/upload-resume";
import { FORMS, pluralize } from "@/lib/czech-plural";
import {
  fetchPendingUploads,
  runUploads,
  UploadRejection,
  type UploadItemState,
} from "@/lib/upload-run";

// The transport lives in src/lib/upload-run.ts, shared with the guest uploader
// (docs/GUEST-GALLERIES.md §6) — this component is the photographer's UI over it.

interface Item {
  file: File;
  state: UploadItemState;
  error?: string;
}

export function Uploader({ galleryId }: { galleryId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingRows, setPendingRows] = useState<PendingUpload[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Rows left behind by an interrupted upload. Re-picking those exact files
  // reuses the rows instead of creating a second set (src/lib/upload-resume.ts).
  const credentials = useMemo(() => ({ kind: "owner" as const, galleryId }), [galleryId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPendingUploads(credentials, controller.signal).then(setPendingRows);
    return () => controller.abort();
  }, [credentials]);

  const update = useCallback((index: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      setItems(files.map((file) => ({ file, state: "pending" as const })));
      setFatal(null);
      setRunning(true);

      // Computed once for the whole selection: each pending row may be claimed
      // by only one file, which a per-batch match could not guarantee.
      const resumeIds = matchResumeTargets(files, pendingRows);

      await runUploads({
        files,
        credentials,
        resumeIds,
        onItem: update,
        onFatal: (rejection) => setFatal(ownerRejectionMessage(rejection)),
        onSkipped: (rejection, count) =>
          setFatal(
            count > 1
              ? `${ownerRejectionMessage(rejection)} (přeskočeno ${count} souborů, zbytek nahrávám)`
              : ownerRejectionMessage(rejection),
          ),
      });

      setRunning(false);
      // Photos only become visible once the server flips them to CONFIRMED, so
      // the grid above is stale until the Server Component re-renders.
      router.refresh();
      setPendingRows(await fetchPendingUploads(credentials));
    },
    [credentials, pendingRows, router, update],
  );

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error").length;

  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-medium">Nahrát fotky</h2>

      {fatal && (
        <p className="mt-3 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {fatal}
        </p>
      )}

      {pendingRows.length > 0 && !running && (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <p className="font-medium">{pluralize(pendingRows.length, FORMS.upload)}</p>
          <p className="mt-1 text-xs">
            Vyber ty samé soubory znovu — naváže se na ně a nevzniknou duplicity. Neobnovené zbytky
            se po 24 hodinách uklidí samy.
          </p>
          <ul className="mt-2 max-h-24 overflow-y-auto text-xs text-neutral-600 dark:text-neutral-400">
            {pendingRows.map((row) => (
              <li key={row.id}>
                {row.fileName}
                {row.sizeBytes !== null && ` · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        disabled={running}
        className="mt-3 block w-full text-sm"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void start(files);
        }}
      />

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-neutral-500">
            {done}/{items.length} nahráno
            {failed > 0 && <span className="text-red-600"> · {failed} selhalo</span>}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-neutral-900 transition-all dark:bg-neutral-100"
              style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
            />
          </div>
          {failed > 0 && (
            <ul className="max-h-32 overflow-y-auto text-xs text-red-600">
              {items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.state === "error")
                .map(({ item, index }) => (
                  <li key={index}>
                    {item.file.name}: {item.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Owner-side wording for a refusal the server named. */
function ownerRejectionMessage(rejection: UploadRejection): string {
  switch (rejection.code) {
    case "unsupported_type":
      return rejection.detail.reason === "heic"
        ? `${rejection.detail.fileName ?? "Soubor"}: HEIC zatím neumíme. Exportuj jako JPEG.`
        : `${rejection.detail.fileName ?? "Soubor"}: nepodporovaný formát.`;
    case "unauthorized":
      return "Přihlášení vypršelo. Načti stránku znovu.";
    case "upload_denied":
      return "Galerie už nepřijímá nahrávání.";
    case "quota_exceeded":
      return "Galerie je plná.";
    case "file_too_large":
      return `${rejection.detail.fileName ?? "Soubor"} je příliš velký.`;
    default:
      return "Nahrávání selhalo. Zkus to prosím znovu.";
  }
}
