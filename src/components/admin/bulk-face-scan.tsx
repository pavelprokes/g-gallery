"use client";

import { unstable_isUnrecognizedActionError, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { createFaceFinder, type FaceFinder } from "@/lib/social-video/detect";
import {
  inLanes,
  RESCAN_CONTINUE_PARAM,
  SCAN_BATCH,
  scanFaces,
  withRetry,
} from "@/lib/social-video/face-scan";
import { saveFaces } from "@/app/admin/social-video-actions";
import { fetchForFaces, NOT_LOADED, type ScanPhoto } from "@/components/admin/face-scan";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface RescanGallery {
  id: string;
  title: string;
  photos: ScanPhoto[];
}

/** Photos in a row that fail to load or search: past it, something is wrong
 * with the connection or the worker, not with the photos, and going on would
 * only fetch the rest of the library for nothing. */
const FAILURE_STREAK = 10;

/** Face workers at once. Each runs its WASM on one thread, so a lane is one
 * core: the rest are left to the page and the browser, and past three the
 * memory (~30 MB of WASM and models a worker) buys little more. */
const MAX_LANES = 3;

function laneCount(): number {
  const cores = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(MAX_LANES, cores - 1));
}

type State =
  | { kind: "idle" }
  | { kind: "running"; done: number; galleries: string[] }
  | { kind: "paused"; done: number }
  | { kind: "stopped"; reason: "streak" | "save" }
  | { kind: "finished"; failed: number }
  | { kind: "reloading" };

/** One gallery's photos, cut into the batches one save stores — what a lane
 * takes at a time. */
interface Chunk {
  gallery: number;
  photos: ScanPhoto[];
}

/**
 * Every gallery's photos that the face scan still owes something — faces never
 * searched, or the sharp part not yet looked for (docs/SOCIAL-VIDEO.md §4–§5) —
 * searched in this tab by a few face workers at once, each taking the next
 * batch of photos as it finishes one, with the same fetch and saving as the
 * gallery page's own scan (`scanFaces`). A save that fails is tried again; one
 * that still fails — a new deployment the old page's actions no longer reach,
 * an expired session — reloads the page, which lists only what is left and
 * goes on by itself. Paused or closed halfway, the saved part stays saved.
 */
export function BulkFaceScan({
  galleries,
  autoStart = false,
}: {
  galleries: RescanGallery[];
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const findersRef = useRef<FaceFinder[]>([]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const finder of findersRef.current) finder.close();
      findersRef.current = [];
    },
    [],
  );

  const chunks = useMemo<Chunk[]>(
    () =>
      galleries.flatMap((gallery, index) =>
        Array.from({ length: Math.ceil(gallery.photos.length / SCAN_BATCH) }, (_, i) => ({
          gallery: index,
          photos: gallery.photos.slice(i * SCAN_BATCH, (i + 1) * SCAN_BATCH),
        })),
      ),
    [galleries],
  );
  /** Photos finished in each chunk — searched in order, so its first ones. */
  const chunkDoneRef = useRef<number[]>([]);
  /** Whether a save has gone through since the page loaded: a reload helps
   * only if the last one got somewhere, or it would reload forever. */
  const savedRef = useRef(false);
  const failedRef = useRef(0);
  // A refreshed list is what is left: its chunks start from nothing.
  useEffect(() => {
    chunkDoneRef.current = [];
  }, [chunks]);

  const total = galleries.reduce((sum, g) => sum + g.photos.length, 0);
  const doneCount = () => chunkDoneRef.current.reduce((sum, n) => sum + n, 0);

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    let streak = 0;
    const counted = async <T,>(work: Promise<T>): Promise<T> => {
      try {
        const result = await work;
        streak = 0;
        return result;
      } catch (cause) {
        streak += 1;
        if (streak >= FAILURE_STREAK) controller.abort();
        throw cause;
      }
    };
    const finder = (lane: number) => (findersRef.current[lane] ??= createFaceFinder());

    // A lane's gallery, for the progress line.
    const active: (number | undefined)[] = [];
    const report = () =>
      setState({
        kind: "running",
        done: doneCount(),
        galleries: [...new Set(active.filter((g) => g !== undefined))].map(
          (g) => galleries[g]!.title,
        ),
      });

    const pending = chunks
      .map((chunk, index) => ({ chunk, index, from: chunkDoneRef.current[index] ?? 0 }))
      .filter(({ chunk, from }) => from < chunk.photos.length);
    report();
    try {
      await inLanes(
        pending,
        laneCount(),
        async ({ chunk, index, from }, _, lane) => {
          active[lane] = chunk.gallery;
          report();
          const galleryId = galleries[chunk.gallery]!.id;
          const progress = await scanFaces({
            photos: chunk.photos.slice(from),
            fetchPhoto: (photo) => counted(fetchForFaces(photo)),
            find: (blob) => counted(finder(lane).find(blob)),
            save: (entries) =>
              withRetry(() => saveFaces(galleryId, entries), {
                // The page is from an older deployment: only a reload helps.
                retryable: (error) => !unstable_isUnrecognizedActionError(error),
              }),
            onSaved: () => {
              savedRef.current = true;
            },
            onProgress: ({ done }) => {
              chunkDoneRef.current[index] = from + done;
              report();
            },
            signal: controller.signal,
          });
          failedRef.current += progress.failed;
          active[lane] = undefined;
        },
        controller,
      );
    } catch (cause) {
      // Saving failed even after the retries — the session, the deployment,
      // the database. What was saved before stays saved.
      console.warn("[g-gallery/faces] bulk scan: save failed", cause);
      abortRef.current = null;
      if (savedRef.current) {
        setState({ kind: "reloading" });
        window.location.replace(`/admin/prepocet?${RESCAN_CONTINUE_PARAM}=1`);
      } else {
        setState({ kind: "stopped", reason: "save" });
        router.refresh();
      }
      return;
    }
    abortRef.current = null;
    if (controller.signal.aborted) {
      if (streak >= FAILURE_STREAK) {
        setState({ kind: "stopped", reason: "streak" });
        // The photos that failed count as done here; the fresh list has them.
        router.refresh();
      } else {
        setState({ kind: "paused", done: doneCount() });
      }
      return;
    }
    setState({ kind: "finished", failed: failedRef.current });
    router.refresh();
  };

  // After a reload the page goes on by itself. Started a tick later, so React's
  // development double mount does not start it twice.
  useEffect(() => {
    if (!autoStart || total === 0) return;
    const timer = setTimeout(() => void run(), 0);
    return () => clearTimeout(timer);
    // Once, on the first render: `run` reads refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (total === 0) {
    return (
      <Card className="text-sm" role="status">
        Všechny fotky jsou přepočítané. Není co dělat.
      </Card>
    );
  }

  const canStart = state.kind === "idle" || state.kind === "finished" || state.kind === "stopped";
  return (
    <Card className="space-y-4">
      <p className="text-sm">
        K přepočtu: {pluralize(total, FORMS.photo)}, {pluralize(galleries.length, FORMS.gallery)}.
        Běží v tomto okně — nech ho otevřené, dokud nedoběhne. Co se uloží, zůstane uložené, i když
        okno zavřeš dřív.
      </p>
      {(state.kind === "running" || state.kind === "paused") && (
        <div className="space-y-2" role="status">
          <p className="text-sm">
            {state.kind === "running" && state.galleries.length > 0 && (
              <>{state.galleries.join(", ")} — </>
            )}
            celkem {state.done}/{total}
            {state.kind === "paused" && " (pozastaveno)"}
          </p>
          <progress className="w-full" value={state.done} max={total} />
        </div>
      )}
      {state.kind === "reloading" && (
        <p className="text-sm" role="status">
          Ukládání se nepovedlo — obnovuji stránku, přepočet pak pokračuje sám.
        </p>
      )}
      {state.kind === "finished" && (
        <p className="text-sm" role="status">
          Hotovo.
          {state.failed > 0 && ` ${pluralize(state.failed, NOT_LOADED)}, zkusí se příště.`}
        </p>
      )}
      {state.kind === "stopped" && (
        <p className="text-admin-danger text-sm" role="status">
          {state.reason === "streak"
            ? `Zastaveno: ${FAILURE_STREAK} fotek po sobě se nepodařilo načíst nebo projít. Zkontroluj připojení a zkus to znovu.`
            : "Zastaveno: výsledky se nepodařilo uložit. Co se uložilo předtím, zůstává; zkus to znovu."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canStart && (
          <Button onClick={() => void run()}>
            {state.kind === "idle" ? "Přepočítat vše" : "Přepočítat zbytek"}
          </Button>
        )}
        {state.kind === "running" && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            Pozastavit
          </Button>
        )}
        {state.kind === "paused" && <Button onClick={() => void run()}>Pokračovat</Button>}
      </div>
    </Card>
  );
}
