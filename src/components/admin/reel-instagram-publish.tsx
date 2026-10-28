"use client";

import { useEffect, useRef, useState } from "react";
import {
  createInstagramReel,
  instagramReelStatus,
  prepareReelUpload,
  publishInstagramReel,
} from "@/app/admin/instagram-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** How often the page asks whether Instagram has the video ready, and for
 * how long (docs/INSTAGRAM-PUBLISH.md §3.6). */
const POLL_MS = 10_000;
const POLL_LIMIT_MS = 5 * 60_000;

type Step =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "uploading" }
  | { kind: "processing"; since: number }
  | { kind: "publishing" }
  | { kind: "done"; permalink: string | null }
  | { kind: "error"; message: string; reconnect: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One rendered reel to the connected Instagram account: confirmed first —
 * publishing is public and immediate — then uploaded to the bucket (never
 * through Vercel), handed to Meta, waited for, and published.
 */
export function InstagramPublish({
  file,
  username,
  audioId,
  silent,
  h264,
}: {
  file: File;
  username: string;
  /** Instagram's track to attach, for a reel cut to Instagram's music. */
  audioId: string | null;
  /** The file has no sound of its own. */
  silent: boolean;
  /** Instagram takes H.264 only (docs/INSTAGRAM-PUBLISH.md F2). */
  h264: boolean;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [caption, setCaption] = useState("");
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  if (!h264) {
    return (
      <p className="text-admin-muted text-caption dark:text-neutral-400">
        Instagram přijme jen video v H.264 — tenhle prohlížeč umí jen VP9. Vytvoř ho v Chrome nebo
        Safari na Macu.
      </p>
    );
  }

  const fail = (message: string, reconnect = false) =>
    setStep({ kind: "error", message, reconnect });

  const publish = async () => {
    try {
      setStep({ kind: "uploading" });
      const target = await prepareReelUpload();
      const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: file });
      if (!put.ok) return fail(`Nahrání do úložiště se nepovedlo (${put.status}).`);

      const created = await createInstagramReel({
        name: target.name,
        caption,
        audio: audioId ? { audioId, audioVolume: 100, videoVolume: 0 } : undefined,
      });
      if (!created.ok) return fail(created.error, created.reconnect);

      const since = Date.now();
      setStep({ kind: "processing", since });
      for (;;) {
        if (cancelled.current) return;
        const status = await instagramReelStatus(created.containerId);
        if (!status.ok) return fail(status.error, status.reconnect);
        if (status.status === "FINISHED") break;
        if (status.status !== "IN_PROGRESS") {
          return fail(
            `Instagram video nezpracoval (${status.status}${status.detail ? `: ${status.detail}` : ""}).`,
          );
        }
        if (Date.now() - since > POLL_LIMIT_MS) {
          return fail("Instagram zpracovává video déle než 5 minut. Zkus to později znovu.");
        }
        await sleep(POLL_MS);
      }

      setStep({ kind: "publishing" });
      const published = await publishInstagramReel(created.containerId);
      if (!published.ok) return fail(published.error, published.reconnect);
      setStep({ kind: "done", permalink: published.permalink });
    } catch (cause) {
      console.error("[g-gallery/instagram] publish failed", cause);
      fail("Publikování se nepovedlo. Zkus to znovu.");
    }
  };

  const busy =
    step.kind === "uploading" || step.kind === "processing" || step.kind === "publishing";

  return (
    <div className="border-admin-border space-y-2 rounded-lg border p-3 dark:border-neutral-700">
      <p className="text-sm font-semibold">Na Instagram @{username}</p>
      {step.kind === "done" ? (
        <Alert tone="success" compact>
          Reel je zveřejněný.{" "}
          {step.permalink && (
            <a className="underline" href={step.permalink} target="_blank" rel="noreferrer">
              Otevřít na Instagramu
            </a>
          )}
        </Alert>
      ) : (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={2200}
            rows={3}
            disabled={busy}
            placeholder="Popisek (nepovinný)"
            aria-label="Popisek reelu"
            className="border-admin-border w-full rounded-lg border p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          {audioId ? (
            <p className="text-caption">Připojí se písnička z Instagramu.</p>
          ) : silent ? (
            <p className="text-caption">
              Video je bez zvuku — písničku přidáš v aplikaci Instagram.
            </p>
          ) : null}
          {step.kind === "confirm" ? (
            <div className="space-y-2">
              <p className="text-sm">
                Zveřejnit na <strong>@{username}</strong>? Uvidí to tví sledující — publikování se
                nedá vrátit tlačítkem.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => void publish()}>Ano, zveřejnit</Button>
                <Button variant="secondary" onClick={() => setStep({ kind: "idle" })}>
                  Zpět
                </Button>
              </div>
            </div>
          ) : busy ? (
            <p className="text-sm" role="status">
              {step.kind === "uploading"
                ? "Nahrávám video…"
                : step.kind === "processing"
                  ? "Instagram zpracovává video…"
                  : "Zveřejňuji…"}
            </p>
          ) : (
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => setStep({ kind: "confirm" })}
            >
              Publikovat na Instagram
            </Button>
          )}
          {step.kind === "error" && (
            <Alert tone="danger" compact>
              {step.message}
              {step.reconnect && (
                <>
                  {" "}
                  <a className="underline" href="/api/instagram/connect">
                    Připojit znovu
                  </a>
                </>
              )}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
