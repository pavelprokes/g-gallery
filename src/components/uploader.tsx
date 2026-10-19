"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  matchResumeTargets,
  planPick,
  type ExistingPhoto,
  type PendingUpload,
  type PickPlan,
} from "@/lib/upload-resume";
import { czechPlural, FORMS, pluralize } from "@/lib/czech-plural";
import {
  CANCELLED,
  fetchPendingUploads,
  fetchReplaceCandidates,
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
  /** The photo this corrected export replaces, kept so a retry still does. */
  replaceId?: string;
  /** The name it is stored under when that is not its own (`slotter`). */
  uploadName?: string;
}

/** A selection waiting on "replace / file these?" (docs/REPLACE-PHOTOS.md). */
interface Review {
  files: File[];
  /** Per file, what can happen to it (`planPick`). */
  plans: PickPlan[];
  names: Map<string, string>;
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
  const [review, setReview] = useState<Review | null>(null);
  // Between a pick and its start, while the replace candidates load: a second
  // pick then would start two runs over the same refs.
  const [preparing, setPreparing] = useState(false);
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
    async (
      files: File[],
      replaceIds: (string | undefined)[] = [],
      uploadNames: (string | undefined)[] = [],
    ) => {
      setReview(null);
      const initial = files.map((file, index) => ({
        file,
        state: "pending" as const,
        replaceId: replaceIds[index],
        uploadName: uploadNames[index],
      }));
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
      const resumeIds = matchResumeTargets(
        files.map((file, index) => ({ name: uploadNames[index] ?? file.name, size: file.size })),
        pending,
      );

      await runUploads({
        files,
        credentials,
        resumeIds,
        replaceIds,
        names: uploadNames,
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
      if (photos.length === 0 || running || preparing || review) return;
      setPreparing(true);
      // A corrected export carries the shot's camera name after a new sequence
      // number; pairing it with the delivered photo is asked about, never
      // assumed — the old file is deleted (docs/REPLACE-PHOTOS.md).
      void fetchReplaceCandidates(galleryId).then(({ pending, existing }) => {
        setPreparing(false);
        // Pairs, new shots filed by camera number, and resumed rows — all
        // decided in src/lib/upload-resume.ts, all asked about first.
        const plans = planPick(photos, pending, existing);
        if (!plans.some((plan) => plan.candidates.length > 0 || plan.slot || plan.lostTarget)) {
          return void start(photos);
        }
        setReview({
          files: photos,
          plans,
          names: new Map(existing.map((photo: ExistingPhoto) => [photo.id, photo.fileName])),
        });
      });
    },
    [galleryId, preparing, review, running, start],
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
      event.dataTransfer.dropEffect = running || preparing || review ? "none" : "copy";
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
      if (running || preparing || review) return;
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

      {review && !running && (
        <ReplaceReview
          review={review}
          onConfirm={(replaceIds, uploadNames) => void start(review.files, replaceIds, uploadNames)}
          // A resumed row filed under another name keeps it, or it is not resumed.
          onAsNew={() =>
            void start(
              review.files,
              [],
              review.plans.map((plan) => plan.keepName),
            )
          }
          onCancel={() => setReview(null)}
        />
      )}

      {!running && !review && !preparing && (
        <div
          className={`mt-3 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? "border-brand-primary bg-admin-accent-soft dark:bg-neutral-800"
              : "border-admin-border dark:border-neutral-700"
          }`}
        >
          <p className="text-brand-ink font-medium dark:text-neutral-100 max-sm:pointer-coarse:hidden">
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
          {/* The export spec lives here, at the point of upload, because nothing
              downstream converts the file (docs/VIDEO.md): what is picked is
              exactly what the couple streams and downloads. */}
          <details className="text-admin-muted w-full max-w-md text-left text-xs dark:text-neutral-400">
            <summary className="cursor-pointer text-center">
              I video · MP4 (H.264), nejvýš 4K — jak ho exportovat
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="font-medium">Formát</dt>
              <dd>MP4 (.mp4). MOV a HEVC (H.265) neprojdou.</dd>
              <dt className="font-medium">Video</dt>
              <dd>
                H.264, nejvýš 4K (4096 px na delší straně, na šířku i na výšku). Doporučeno 1080p —
                na telefonu v sále se rozjede rychleji. Snímková frekvence jako ve střihu.
              </dd>
              <dt className="font-medium">Datový tok</dt>
              <dd>1080p 8–10 Mbit/s (3 min ≈ 200 MB) · 4K 35–45 Mbit/s (3 min ≈ 900 MB)</dd>
              <dt className="font-medium">Zvuk</dt>
              <dd>AAC, 48 kHz, stereo, 192–320 kbit/s</dd>
              <dt className="font-medium">Limit</dt>
              <dd>
                Rozlišení do 4K. Velikost souboru hlídá jen technický strop 2 GB (≈ 6 min 4K při 45
                Mbit/s, 30 min 1080p). Bez metadat o poloze.
              </dd>
              <dt className="font-medium">Resolve</dt>
              <dd>
                Deliver → Format MP4, Codec H.264, Quality 8–10 000 kb/s (4K: 35–45 000); „Network
                Optimization“ zapnout, pokud ji verze nabízí (video se rozjede dřív)
              </dd>
              <dt className="font-medium">Pořadí</dt>
              <dd>
                Podle názvu souboru. Pojmenuj video číslem fotky, za kterou má stát, např.{" "}
                <code>svatba_0412_tanec.mp4</code>
              </dd>
            </dl>
            <p className="mt-2">
              Nic se nepřevádí: hosté přehrávají i stahují přesně tenhle soubor. Náhledový snímek
              (čtvrtina délky) udělá prohlížeč sám při nahrání.
            </p>
          </details>
          <input
            ref={filesRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4"
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
              <Button
                size="sm"
                onClick={() =>
                  void start(
                    retriable.map((item) => item.file),
                    retriable.map((item) => item.replaceId),
                    retriable.map((item) => item.uploadName),
                  )
                }
              >
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
                    {item.file.name}: {itemErrorMessage(item.error)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** "nová" in the per-file choice: upload as an extra photo, replace nothing. */
const AS_NEW = "new";

function ReplaceReview({
  review,
  onConfirm,
  onAsNew,
  onCancel,
}: {
  review: Review;
  onConfirm: (replaceIds: (string | undefined)[], uploadNames: (string | undefined)[]) => void;
  onAsNew: () => void;
  onCancel: () => void;
}) {
  // A sure pair is chosen already; any other waits for the photographer.
  const [choices, setChoices] = useState(() => review.plans.map((plan) => plan.preselect ?? ""));
  const replaceIds = choices.map((choice) => (choice && choice !== AS_NEW ? choice : undefined));
  const uploadNames = review.plans.map(
    (plan, index) => plan.keepName ?? (replaceIds[index] ? undefined : plan.slot?.name),
  );
  const replacing = replaceIds.filter(Boolean).length;
  const filing = review.plans.filter((plan, index) => !replaceIds[index] && plan.slot).length;
  const undecided = review.plans.some(
    (plan, index) => plan.candidates.length > 0 && !choices[index],
  );
  const listed = review.plans.filter(
    (plan) => plan.candidates.length > 0 || plan.slot || plan.lostTarget,
  ).length;
  const rest = review.files.length - listed;
  // Where a file goes when it does not replace: said, never a surprise.
  const destination = (plan: PickPlan) =>
    plan.slot ? (
      <>
        nová, zařadí se za <span className="font-medium">{plan.slot.after}</span>
      </>
    ) : (
      "nová, pod svým názvem"
    );

  return (
    <Alert className="mt-3">
      <p className="font-medium">Opravené a nové fotky</p>
      <p className="mt-1 text-xs">
        Nahrazená fotka si nechá své místo, čas, srdíčka, značky k tisku i jména u obličejů — vymění
        se jen soubor a ten starý se smaže. Nová fotka se zařadí za fotku s nejbližším nižším číslem
        z fotoaparátu.
        {rest > 0 &&
          ` ${rest} ${czechPlural(rest, {
            one: "další se nahraje beze změny",
            few: "další se nahrají beze změny",
            many: "dalších se nahraje beze změny",
          })}.`}
      </p>
      <ul
        aria-label="Co se nahradí"
        className="text-admin-muted mt-2 max-h-60 space-y-0.5 overflow-y-auto text-xs dark:text-neutral-400"
      >
        {review.files.map((file, index) => {
          const plan = review.plans[index]!;
          const ids = plan.candidates;
          // Every pair is a choice: a sure one comes pre-selected, but two
          // bodies' `DSC_0412` are different moments, so each can be turned
          // down on its own.
          if (ids.length > 0) {
            return (
              <li key={index} className="flex flex-wrap items-center gap-1">
                {file.name} →{ids.length > 1 && ` v galerii ${ids.length}× —`}
                <select
                  aria-label={`Co nahradí ${file.name}`}
                  value={choices[index]}
                  onChange={(event) =>
                    setChoices((prev) =>
                      prev.map((choice, i) => (i === index ? event.target.value : choice)),
                    )
                  }
                  className="rounded border px-1 py-0.5 text-xs dark:bg-neutral-800"
                >
                  {!plan.preselect && (
                    <option value="" disabled>
                      {ids.length > 1 ? "vyber, kterou nahradit…" : "nahradit, nebo přidat?"}
                    </option>
                  )}
                  {ids.map((id) => (
                    <option key={id} value={id}>
                      nahradit {review.names.get(id)}
                    </option>
                  ))}
                  <option value={AS_NEW}>nenahrazovat, přidat jako novou</option>
                </select>
                {choices[index] === AS_NEW && <span>→ {destination(plan)}</span>}
              </li>
            );
          }
          if (plan.lostTarget) {
            return (
              <li key={index} className="truncate">
                {file.name} → fotka, kterou měl nahradit, už v galerii není: {destination(plan)}
              </li>
            );
          }
          return plan.slot ? (
            <li key={index} className="truncate">
              {file.name} → {destination(plan)}
            </li>
          ) : null;
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={undecided} onClick={() => onConfirm(replaceIds, uploadNames)}>
          {replacing > 0 && filing > 0
            ? "Nahradit a zařadit"
            : replacing > 0
              ? `Nahradit ${pluralize(replacing, FORMS.photoAccusative)}`
              : filing > 0
                ? "Zařadit a nahrát"
                : "Nahrát"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onAsNew}>
          Nahrát beze změn
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Zrušit
        </Button>
      </div>
    </Alert>
  );
}

/** Why a file was refused by type, in the photographer's words (docs/VIDEO.md for video). */
function unsupportedReason(reason: string | undefined): string {
  switch (reason) {
    case "heic":
      return "HEIC zatím neumíme. Exportuj jako JPEG.";
    case "video":
      return "video jen jako MP4 (H.264). Exportuj ho znovu jako MP4.";
    case "video_codec":
      return "video musí být H.264 — tohle je jiný kodek (nejspíš HEVC z telefonu), řada prohlížečů by ho nepřehrála. Exportuj ho znovu jako H.264.";
    case "video_too_large":
      return "video je větší než 2 GB — to je technický strop jednoho souboru. Exportuj ho s nižším datovým tokem (4K kolem 35 Mbit/s, 1080p 8–10).";
    case "video_unreadable":
      return "soubor se nedá přečíst jako MP4. Exportuj ho znovu jako MP4 (H.264).";
    case "video_resolution":
      return "video má vyšší rozlišení než 4K. Exportuj ho nejvýš ve 4K (4096 px na delší straně), ideálně v 1080p.";
    case "video_location":
      return "video obsahuje polohu, kde vzniklo. Exportuj ho znovu bez metadat o poloze.";
    default:
      return "nepodporovaný formát.";
  }
}

/** A failed item's line: `unsupported_type:<reason>` gets its sentence, the rest stays as is. */
function itemErrorMessage(error: string | undefined): string {
  if (!error) return "nenahráno";
  if (error.startsWith("unsupported_type")) return unsupportedReason(error.split(":")[1]);
  if (error === "file_too_large") return "soubor je příliš velký.";
  return error;
}

/** Owner-side wording for a refusal the server named. */
function ownerRejectionMessage(rejection: UploadRejection): string {
  switch (rejection.code) {
    case "unsupported_type":
      return `${rejection.detail.fileName ?? "Soubor"}: ${unsupportedReason(rejection.detail.reason)}`;
    case "unauthorized":
      return "Přihlášení vypršelo. Načti stránku znovu.";
    case "upload_denied":
      return "Galerie už nepřijímá nahrávání.";
    case "quota_exceeded":
      return "Galerie je plná.";
    case "file_too_large":
      return rejection.detail.maxBytes
        ? `${rejection.detail.fileName ?? "Soubor"} je příliš velký (nejvýš ${formatBytes(rejection.detail.maxBytes)}).`
        : `${rejection.detail.fileName ?? "Soubor"} je příliš velký.`;
    default:
      return "Nahrávání selhalo. Zkus to prosím znovu.";
  }
}
