"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchResumeTargets, type PendingUpload } from "@/lib/upload-resume";
import { FORMS, pluralize } from "@/lib/czech-plural";
import {
  CANCELLED,
  fetchPendingUploads,
  runUploads,
  UploadRejection,
  type UploadItemState,
} from "@/lib/upload-run";
import {
  filesFromDrop,
  formatBytes,
  formatEta,
  selectPhotos,
  smoothSpeed,
} from "@/lib/upload-drop";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { holdScreenAwake, type HeldWakeLock } from "@/lib/wake-lock";

// The transport lives in src/lib/upload-run.ts, shared with the guest uploader
// (docs/GUEST-GALLERIES.md §6) — this component is the photographer's UI over it.

interface Item {
  file: File;
  state: UploadItemState;
  error?: string;
}

interface Stats {
  sent: number;
  total: number;
  /** Bytes per second, smoothed; null until there is enough data to trust. */
  speed: number | null;
  /** Bytes of the files in flight, for their own small bars. */
  active: { index: number; sent: number }[];
}

const TICK_MS = 250;
const SPEED_SAMPLE_MS = 1000;
/** No speed or ETA before this — the first seconds are presign and worker warm-up. */
const ETA_AFTER_MS = 5000;

const isRetriable = (item: Item) =>
  item.state === "error" && !item.error?.startsWith("unsupported_type");

export function Uploader({ galleryId }: { galleryId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [pendingRows, setPendingRows] = useState<PendingUpload[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Byte progress arrives many times a second per file. It lives in refs and is
  // painted on a timer: routing it through React state would re-render the
  // whole list for every progress event of every file.
  const bytesRef = useRef<number[]>([]);
  const statesRef = useRef<Item[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  // Rows left behind by an interrupted upload. Re-picking those exact files
  // reuses the rows instead of creating a second set (src/lib/upload-resume.ts).
  const credentials = useMemo(() => ({ kind: "owner" as const, galleryId }), [galleryId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPendingUploads(credentials, controller.signal).then(setPendingRows);
    return () => controller.abort();
  }, [credentials]);

  const update = useCallback((index: number, patch: Partial<Item>) => {
    statesRef.current[index] = { ...statesRef.current[index]!, ...patch };
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      const initial = files.map((file) => ({ file, state: "pending" as const }));
      statesRef.current = initial;
      bytesRef.current = files.map(() => 0);
      setItems(initial);
      setFatal(null);
      setStats(null);
      setRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Fetched again rather than taken from state: a retry right after a run
      // must find the rows that run left behind, or it would duplicate them.
      const pending = await fetchPendingUploads(credentials);
      // Computed once for the whole selection: each pending row may be claimed
      // by only one file, which a per-batch match could not guarantee.
      const resumeIds = matchResumeTargets(files, pending);

      await runUploads({
        files,
        credentials,
        resumeIds,
        signal: controller.signal,
        onItem: update,
        onBytes: (index, sent) => {
          bytesRef.current[index] = sent;
        },
        onFatal: (rejection) => setFatal(ownerRejectionMessage(rejection)),
        onSkipped: (rejection, count) =>
          setFatal(
            count > 1
              ? `${ownerRejectionMessage(rejection)} (přeskočeno ${count} souborů, zbytek nahrávám)`
              : ownerRejectionMessage(rejection),
          ),
      });

      abortRef.current = null;
      setRunning(false);
      // Photos only become visible once the server flips them to CONFIRMED, so
      // the grid above is stale until the Server Component re-renders.
      router.refresh();
      setPendingRows(await fetchPendingUploads(credentials));
    },
    [credentials, router, update],
  );

  const pick = useCallback(
    (raw: File[]) => {
      const { photos, ignored } = selectPhotos(raw);
      setNotice(
        ignored > 0 ? `Přeskočeno: ${ignored} × ne-fotka (.xmp, RAW, systémové soubory…).` : null,
      );
      if (photos.length > 0) void start(photos);
    },
    [start],
  );

  // Progress painter: overall bytes, smoothed speed, tab title, milestones.
  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now();
    const originalTitle = document.title;
    let lastSample = { at: startedAt, sent: 0 };
    let speed: number | null = null;
    let lastMilestone = 0;

    const paint = () => {
      const bytes = bytesRef.current;
      let sent = 0;
      let total = 0;
      const active: Stats["active"] = [];
      statesRef.current.forEach((item, index) => {
        // Failed files will send nothing more; counting them would keep the
        // bar short of 100 % and the ETA inflated for the rest of the run.
        if (item.state === "error") return;
        const size = item.file.size;
        total += size;
        if (item.state === "done") sent += size;
        else if (item.state === "uploading") {
          const fileSent = Math.min(bytes[index] ?? 0, size);
          sent += fileSent;
          active.push({ index, sent: fileSent });
        }
      });

      const now = performance.now();
      if (now - lastSample.at >= SPEED_SAMPLE_MS) {
        const sample = (Math.max(sent - lastSample.sent, 0) * 1000) / (now - lastSample.at);
        speed = smoothSpeed(speed, sample);
        lastSample = { at: now, sent };
      }

      setStats({ sent, total, speed: now - startedAt >= ETA_AFTER_MS ? speed : null, active });

      const percent = total > 0 ? Math.floor((sent / total) * 100) : 0;
      // The tab is usually in the background during a long run.
      document.title = `${percent} % · nahrávám — ${originalTitle}`;
      // Screen readers hear every 10 %, not every progress event.
      if (percent >= lastMilestone + 10) {
        lastMilestone = percent - (percent % 10);
        setAnnouncement(`Nahráno ${lastMilestone} %`);
      }
    };

    const timer = window.setInterval(paint, TICK_MS);
    return () => {
      window.clearInterval(timer);
      paint();
      document.title = originalTitle;
    };
  }, [running]);

  // A long upload must survive the photographer walking away from the desk:
  // keep the screen awake and warn before the tab is closed mid-run. The
  // unload guard exists only while running — it would otherwise block bfcache.
  useEffect(() => {
    if (!running) return;
    let held: HeldWakeLock | null = null;
    let ended = false;
    void holdScreenAwake().then((lock) => {
      if (ended) lock?.release();
      else held = lock;
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      ended = true;
      held?.release();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [running]);

  // The drop zone invites dragging from Finder; a file released anywhere else
  // on the page would make the browser open it in this tab instead.
  useEffect(() => {
    const swallowDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", swallowDrop);
    window.addEventListener("drop", swallowDrop);
    return () => {
      window.removeEventListener("dragover", swallowDrop);
      window.removeEventListener("drop", swallowDrop);
    };
  }, []);

  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "error");
  const retriable = failed.filter(isRetriable);
  const cancelled = failed.filter((i) => i.error === CANCELLED).length;
  const percent = stats && stats.total > 0 ? Math.floor((stats.sent / stats.total) * 100) : 0;
  const eta = stats?.speed ? formatEta((stats.total - stats.sent) / stats.speed) : null;

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = running ? "none" : "copy";
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(dragDepth.current - 1, 0);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (running) return;
      // Entries must be read synchronously inside the drop handler — this call
      // does that before its first await.
      void filesFromDrop(event.dataTransfer).then(pick);
    },
  };

  return (
    <Card as="section" {...dropHandlers}>
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

      {!running && (
        <div
          className={`mt-3 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? "border-brand-primary bg-admin-accent-soft dark:bg-neutral-800"
              : "border-admin-border dark:border-neutral-700"
          }`}
        >
          <p className="text-brand-ink font-medium dark:text-neutral-100">
            {dragging ? "Pusť — nahraju je" : "Přetáhni sem fotky nebo celou složku"}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => filesRef.current?.click()}>Vybrat fotky</Button>
            <Button variant="secondary" onClick={() => folderRef.current?.click()}>
              Vybrat složku
            </Button>
          </div>
          <p className="text-admin-muted text-xs dark:text-neutral-400">
            JPEG, PNG, WebP · složky i s podsložkami, ostatní soubory se přeskočí
          </p>
          <input
            ref={filesRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              pick(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            // Non-standard but supported by every engine; React has no typed prop for it.
            {...{ webkitdirectory: "" }}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              pick(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
      )}

      {notice && <p className="text-admin-muted mt-2 text-xs dark:text-neutral-400">{notice}</p>}

      {items.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <p className="text-brand-ink font-medium dark:text-neutral-100">
              {done}/{items.length} nahráno
              {failed.length > 0 && (
                <span className="text-admin-danger"> · {failed.length} nenahráno</span>
              )}
            </p>
            {stats && (
              <p className="text-admin-muted tabular-nums dark:text-neutral-400">
                {formatBytes(stats.sent)} z {formatBytes(stats.total)}
                {running && stats.speed !== null && (
                  <> · {(stats.speed / 1024 ** 2).toFixed(1).replace(".", ",")} MB/s</>
                )}
                {running && eta && <> · zbývá {eta}</>}
              </p>
            )}
          </div>

          <progress
            aria-label="Průběh nahrávání"
            max={stats?.total || 1}
            value={stats?.sent ?? 0}
            aria-valuetext={`${percent} %, ${done} z ${items.length} fotek${eta ? `, zbývá ${eta}` : ""}`}
            className="bg-admin-accent-soft [&::-moz-progress-bar]:bg-brand-primary [&::-webkit-progress-bar]:bg-admin-accent-soft [&::-webkit-progress-value]:bg-brand-primary block h-2.5 w-full appearance-none overflow-hidden rounded-full dark:bg-neutral-800 [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-200"
          />
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>

          {running && stats && stats.active.length > 0 && (
            <ul className="space-y-1.5" aria-label="Právě se nahrává">
              {stats.active.map(({ index, sent }) => {
                const file = items[index]?.file;
                if (!file) return null;
                const filePercent = file.size > 0 ? Math.floor((sent / file.size) * 100) : 0;
                return (
                  <li key={index} className="flex items-center gap-3 text-xs">
                    <span className="text-admin-muted w-40 truncate dark:text-neutral-400">
                      {file.name}
                    </span>
                    <span className="bg-admin-accent-soft h-1 flex-1 overflow-hidden rounded-full dark:bg-neutral-800">
                      <span
                        className="bg-brand-primary block h-full rounded-full opacity-70"
                        style={{ width: `${filePercent}%` }}
                      />
                    </span>
                    <span className="text-admin-muted w-20 text-right tabular-nums dark:text-neutral-400">
                      {/* The last percent waits on R2's response and the confirm call. */}
                      {filePercent >= 99 ? "dokončuji" : `${filePercent} %`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            {running && (
              <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>
                Zrušit nahrávání
              </Button>
            )}
            {!running && retriable.length > 0 && (
              <Button size="sm" onClick={() => void start(retriable.map((item) => item.file))}>
                Nahrát znovu {pluralize(retriable.length, FORMS.photoAccusative)}
              </Button>
            )}
          </div>

          {!running && cancelled > 0 && (
            <p className="text-admin-muted text-xs dark:text-neutral-400">
              Nahrávání zrušeno — zbylé fotky dohraješ tlačítkem výš.
            </p>
          )}

          {failed.length > cancelled && (
            <ul className="text-admin-danger max-h-32 overflow-y-auto text-xs">
              {items
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => item.state === "error" && item.error !== CANCELLED)
                .map(({ item, index }) => (
                  <li key={index}>
                    {item.file.name}: {item.error ?? "nenahráno"}
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
