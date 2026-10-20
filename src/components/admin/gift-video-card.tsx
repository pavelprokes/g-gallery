"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TimelinePosition } from "@/lib/gallery-chapters";
import type { Aspect } from "@/lib/social-video/camera";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { runUploads } from "@/lib/upload-run";
import { saveFaces } from "@/app/admin/social-video-actions";
import { useFaceFinder } from "@/components/admin/face-scan";
import {
  makeGiftVideo,
  NoH264Error,
  type GiftPhoto,
  type GiftProgress,
} from "@/components/admin/gift-video";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

/** Both versions every package includes (docs/SOCIAL-VIDEO.md §1), 15 s each. */
const GIFT: readonly Aspect[] = ["9:16", "16:9"];
const GIFT_LENGTH = 15;

const ASPECT_NAME: Record<Aspect, string> = { "9:16": "na výšku", "16:9": "na šířku" };

type State =
  | { kind: "idle" }
  | { kind: "running"; aspect: Aspect; progress: GiftProgress | null }
  | { kind: "done" }
  | { kind: "failed"; message: string };

function progressText(progress: GiftProgress | null): string {
  if (!progress) return "Připravuji…";
  if (progress.step === "photos") return `Načítám fotky ${progress.done}/${progress.total}`;
  if (progress.step === "faces") return `Připravuji záběry ${progress.done}/${progress.total}`;
  return `Vykresluji ${Math.round(progress.share * 100)} %`;
}

/**
 * The couple's gift in one click: both versions from the suggestion as it
 * stands, rendered and added to the gallery, no editing in between. Opened
 * with `?gift=1` (the gallery page's "Dárkové video"), it starts on its own.
 */
export function GiftVideoCard({
  galleryId,
  galleryTitle,
  photos,
  chapterStarts,
  autoStart,
}: {
  galleryId: string;
  galleryTitle: string;
  photos: GiftPhoto[];
  chapterStarts: TimelinePosition[];
  autoStart: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const finder = useFaceFinder();
  const [state, setState] = useState<State>({ kind: "idle" });
  const faces = useRef<Record<string, PhotoFaces | null>>(
    Object.fromEntries(photos.map((p) => [p.id, p.candidate.faces])),
  );
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for (const aspect of GIFT) {
        setState({ kind: "running", aspect, progress: null });
        const file = await makeGiftVideo({
          photos,
          faces: faces.current,
          chapterStarts,
          aspect,
          length: GIFT_LENGTH,
          title: galleryTitle,
          findFaces: (blob) => finder().find(blob),
          onFaces: (entries) => {
            for (const e of entries) faces.current[e.photoId] = e.faces;
            saveFaces(galleryId, entries).catch((cause) =>
              console.warn("[g-gallery/gift] faces not saved", cause),
            );
          },
          onProgress: (progress) => setState({ kind: "running", aspect, progress }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setState({ kind: "running", aspect, progress: { step: "render", share: 1 } });
        let failure: string | null = null;
        let uploaded = false;
        await runUploads({
          files: [file],
          credentials: { kind: "owner", galleryId },
          resumeIds: [undefined],
          onItem: (_, patch) => {
            if (patch.state === "done") uploaded = true;
            if (patch.state === "error") failure = patch.error ?? "chyba";
          },
          onFatal: (rejection) => {
            failure = rejection.code;
          },
        });
        if (!uploaded) throw new Error(`UPLOAD:${failure ?? "chyba"}`);
      }
      setState({ kind: "done" });
      router.refresh();
    } catch (cause) {
      if (controller.signal.aborted) {
        setState({ kind: "idle" });
        return;
      }
      console.error("[g-gallery/gift] failed", cause);
      setState({
        kind: "failed",
        message:
          cause instanceof NoH264Error
            ? "Tenhle prohlížeč neumí H.264, které galerie potřebuje — otevři stránku v Chrome nebo Safari."
            : "Video se nepodařilo připravit. Zkus to znovu; když to nepůjde, sestav ho níž ručně.",
      });
    } finally {
      abortRef.current = null;
    }
  };

  // Arrived from "Dárkové video": start, and take `?gift=1` off so a reload
  // does not make the gift twice.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    router.replace(pathname);
    void run();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardTitle>Dárek pro pár</CardTitle>
      <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
        Obě verze — na výšku i na šířku, 15 s — z navržených fotek, rovnou do galerie. Bez úprav;
        když chceš vybírat sám, použij editor níž. Záložka musí zůstat otevřená.
      </p>
      {state.kind === "running" ? (
        <div className="space-y-2 text-sm" role="status">
          <p>
            Video {ASPECT_NAME[state.aspect]} ({GIFT.indexOf(state.aspect) + 1}/{GIFT.length}) ·{" "}
            {progressText(state.progress)}
          </p>
          <Button size="sm" variant="secondary" onClick={() => abortRef.current?.abort()}>
            Zrušit
          </Button>
        </div>
      ) : state.kind === "done" ? (
        <p className="text-sm" role="status">
          Hotovo — obě videa jsou v galerii.{" "}
          <Link href={`/admin/g/${galleryId}`} className="underline underline-offset-4">
            Zpět na galerii
          </Link>
        </p>
      ) : (
        <>
          <Button onClick={() => void run()}>Připravit dárek: obě verze do galerie</Button>
          {state.kind === "failed" && (
            <Alert tone="danger" compact className="mt-3">
              {state.message}
            </Alert>
          )}
        </>
      )}
    </Card>
  );
}
