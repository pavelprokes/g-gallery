"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { commitVideoPoster, presignVideoPoster, type PutTarget } from "@/app/admin/video-actions";
import { Button } from "@/components/ui/button";
import { averageColorOf } from "@/lib/placeholder";
import { makeThumbnail } from "@/lib/thumbnail";
import { formatDuration, LOOP_BITS_PER_SECOND, LOOP_MAX_PX, LOOP_SECONDS } from "@/lib/video";
import { drawPoster, loopRecorderType, recordLoop, seekTo } from "@/lib/video-prepare";

/** Where the candidate frames are taken — spread out, clear of the opening fade. */
const CANDIDATES_AT = [0.15, 0.35, 0.55, 0.75];
const CANDIDATE_PX = 320;

interface Candidate {
  seconds: number;
  url: string;
}

/**
 * Lets the photographer choose a video's poster after upload — the frame the
 * upload took blindly can land in a crossfade (docs/VIDEO.md) — and records
 * the few seconds from there that loop on the wedding page's card.
 *
 * Frames are drawn in this browser from the MP4 itself. Straight from the
 * bucket that needs a CORS GET rule; without one the video will not load
 * cross-origin and the photographer picks the same file from disk instead.
 */
export function VideoPosterPicker({
  photoId,
  fileName,
  videoUrl,
}: {
  photoId: string;
  fileName: string;
  videoUrl: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
      >
        Vybrat náhled
      </Button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-label={`Náhled videa ${fileName}`}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100vw-2rem))] overflow-y-auto rounded-xl bg-white p-0 backdrop:bg-black/60 dark:bg-neutral-900 dark:text-neutral-100"
      >
        {/* Mounted only while open: the dialog loads a film, it should not
            do so for every video tile on the page. */}
        {open && (
          <PickerBody
            photoId={photoId}
            fileName={fileName}
            videoUrl={videoUrl}
            onDone={() => dialogRef.current?.close()}
          />
        )}
      </dialog>
    </>
  );
}

function PickerBody({
  photoId,
  fileName,
  videoUrl,
  onDone,
}: {
  photoId: string;
  fileName: string;
  videoUrl: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Remote first; a local file once the bucket turns out not to allow it.
  const [source, setSource] = useState<{ url: string; remote: boolean } | null>(
    videoUrl ? { url: videoUrl, remote: true } : null,
  );
  const [needsFile, setNeedsFile] = useState(!videoUrl);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [withLoop, setWithLoop] = useState(() => loopRecorderType() !== null);
  const [status, setStatus] = useState<string | null>("Načítám video…");
  const [busy, setBusy] = useState(false);
  const canLoop = loopRecorderType() !== null;

  useEffect(() => {
    if (!source || source.remote) return;
    return () => URL.revokeObjectURL(source.url);
  }, [source]);

  const fallBackToFile = () => {
    setNeedsFile(true);
    setCandidates([]);
    setStatus(null);
  };

  const onLoaded = async () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    try {
      const frames: Candidate[] = [];
      for (const at of CANDIDATES_AT) {
        const seconds = video.duration * at;
        await seekTo(video, seconds);
        const blob = await drawPoster(video, CANDIDATE_PX, 0.8);
        frames.push({ seconds, url: URL.createObjectURL(blob) });
      }
      setCandidates(frames);
      setPicked(0);
      await seekTo(video, frames[0]!.seconds);
      setStatus(null);
    } catch (error) {
      // A tainted canvas: the video played but may not be read back.
      if (error instanceof DOMException && error.name === "SecurityError") fallBackToFile();
      else setStatus("Snímky se nepodařilo připravit. Zkus to prosím znovu.");
    }
  };

  useEffect(
    () => () => candidates.forEach((candidate) => URL.revokeObjectURL(candidate.url)),
    [candidates],
  );

  const save = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const at = video.currentTime;
      setStatus("Připravuji náhled…");
      const poster = await drawPoster(video);
      const [thumbnail, placeholder] = await Promise.all([
        makeThumbnail(poster, "owner"),
        averageColorOf(poster),
      ]);

      let loop: Blob | null = null;
      if (withLoop && canLoop) {
        setStatus(`Nahrávám živou smyčku (${LOOP_SECONDS} s)…`);
        loop = await recordLoop(video, at, {
          seconds: LOOP_SECONDS,
          maxPx: LOOP_MAX_PX,
          bitsPerSecond: LOOP_BITS_PER_SECOND,
        }).catch(() => null);
        await seekTo(video, at);
      }

      setStatus("Ukládám…");
      const targets = await presignVideoPoster(photoId, thumbnail?.format ?? null, loop !== null);
      const put = (target: PutTarget, body: Blob) =>
        fetch(target.url, { method: "PUT", headers: target.headers, body }).then((r) => r.ok);
      const [posterOk, thumbOk, loopOk] = await Promise.all([
        put(targets.poster, poster),
        targets.thumb && thumbnail ? put(targets.thumb, thumbnail.blob).catch(() => false) : false,
        targets.loop && loop ? put(targets.loop, loop).catch(() => false) : false,
      ]);
      if (!posterOk) throw new Error("poster PUT failed");

      await commitVideoPoster(photoId, {
        name: targets.name,
        thumb: thumbOk && thumbnail ? thumbnail.format : null,
        loop: loopOk,
        placeholder,
      });
      router.refresh();
      onDone();
    } catch {
      setStatus("Náhled se nepodařilo uložit. Zkus to prosím znovu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold">Náhled videa</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={busy}>
          Zavřít
        </Button>
      </div>
      <p className="text-admin-muted truncate text-sm dark:text-neutral-400">{fileName}</p>

      {needsFile && (
        <label className="block space-y-2 rounded-lg border border-dashed p-4 text-sm">
          <span className="block">
            Video z úložiště tady nejde přehrát pro úpravy. Vyber prosím{" "}
            <strong>stejný soubor</strong> z disku — nikam se znovu nenahrává, jen se z něj vezmou
            snímky.
          </span>
          <input
            type="file"
            accept="video/mp4"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setNeedsFile(false);
              setStatus("Načítám video…");
              setSource({ url: URL.createObjectURL(file), remote: false });
            }}
          />
        </label>
      )}

      {source && !needsFile && (
        <video
          // Remounted per source: crossOrigin must be set before src loads.
          key={source.url}
          ref={videoRef}
          src={source.url}
          crossOrigin={source.remote ? "anonymous" : undefined}
          controls
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => void onLoaded()}
          onError={() => (source.remote ? fallBackToFile() : setStatus("Video nejde přehrát."))}
          className="max-h-[50vh] w-full rounded-lg bg-black"
        />
      )}

      {candidates.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {candidates.map((candidate, index) => (
              <li key={candidate.url}>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={picked === index}
                  onClick={() => {
                    setPicked(index);
                    if (videoRef.current) void seekTo(videoRef.current, candidate.seconds);
                  }}
                  className={`block w-full overflow-hidden rounded-lg ring-offset-2 ${
                    picked === index ? "ring-brand-primary ring-4" : "ring-1 ring-black/10"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
                  <img
                    src={candidate.url}
                    alt={`Snímek v ${formatDuration(candidate.seconds * 1000)}`}
                    className="block w-full"
                  />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-admin-muted text-sm dark:text-neutral-400">
            Žádný nesedí? Posuň video na libovolné místo — uloží se snímek, který je právě vidět.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={withLoop && canLoop}
              disabled={!canLoop || busy}
              onChange={(event) => setWithLoop(event.target.checked)}
              className="accent-brand-primary mt-0.5 size-4"
            />
            <span>
              Živá smyčka na kartě galerie — {LOOP_SECONDS} s bez zvuku od tohoto místa, aby bylo na
              stránce svatby hned vidět, že jde o video.
              {!canLoop && (
                <span className="text-admin-muted block dark:text-neutral-400">
                  Tento prohlížeč ji neumí nahrát jako MP4 — použij Chrome nebo Safari.
                </span>
              )}
            </span>
          </label>
          <div className="flex justify-end">
            <Button type="button" onClick={() => void save()} disabled={busy}>
              Použít tento snímek
            </Button>
          </div>
        </>
      )}

      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
    </div>
  );
}
