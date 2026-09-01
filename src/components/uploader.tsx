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
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { UploadProgressRing } from "@/components/upload-progress-ring";

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
    <Card as="section">
      <CardTitle>Nahrát fotky</CardTitle>

      {fatal && (
        <Alert tone="danger" className="mt-3">
          {fatal}
        </Alert>
      )}

      {pendingRows.length > 0 && !running && (
        <Alert className="mt-3">
          <p className="font-medium">{pluralize(pendingRows.length, FORMS.upload)}</p>
          <p className="mt-1 text-xs">
            Vyber ty samé soubory znovu — naváže se na ně a nevzniknou duplicity. Neobnovené zbytky
            se po 24 hodinách uklidí samy.
          </p>
          <ul className="text-admin-muted mt-2 max-h-24 overflow-y-auto text-xs dark:text-neutral-400">
            {pendingRows.map((row) => (
              <li key={row.id}>
                {row.fileName}
                {row.sizeBytes !== null && ` · ${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
              </li>
            ))}
          </ul>
        </Alert>
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
          <div className="mt-4 flex items-center gap-2">
            <UploadProgressRing
              done={done}
              total={items.length}
              className="text-brand-primary size-6"
            />
            <p className="text-admin-muted text-sm dark:text-neutral-400">
              {done}/{items.length} nahráno
              {failed > 0 && <span className="text-red-600"> · {failed} selhalo</span>}
            </p>
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
    </Card>
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
