"use client";

import { useState } from "react";
import { printDownloadLinks } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

/** Browsers drop downloads started too close together; this spacing is enough for Chrome and Safari. */
const DOWNLOAD_SPACING_MS = 400;
/** Long enough for R2 to answer and the download to start; the frame is useless after. */
const FRAME_LIFETIME_MS = 60_000;

/**
 * Downloads every photo marked for print, one file at a time, each already
 * named for the lab ("5x_…"). The links point at R2 with an attachment
 * disposition, so the bytes never touch Vercel.
 *
 * Each link opens in a hidden frame rather than through a link click: a link
 * that fails (an expired or missing object answers with an XML error page)
 * then fails inside the frame instead of navigating the admin away with the
 * rest of the queue. A cross-origin frame cannot report what happened, so the
 * button ends by saying how many files should have arrived.
 */
export function PrintDownloadButton({ galleryId, count }: { galleryId: string; count: number }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function download() {
    setResult(null);
    setProgress("Připravuji…");
    try {
      const links = await printDownloadLinks(galleryId);
      for (const [index, link] of links.entries()) {
        setProgress(`Stahuji ${index + 1}/${links.length}`);
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.src = link.url;
        document.body.append(frame);
        setTimeout(() => frame.remove(), FRAME_LIFETIME_MS);
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_SPACING_MS));
      }
      setResult(
        `Odesláno ke stažení: ${links.length}. Zkontroluj, že jich ve Stažených souborech dorazilo ${links.length}.`,
      );
    } catch {
      setResult("Stahování se nepovedlo spustit, zkus to znovu.");
    }
    setProgress(null);
  }

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={download}
        disabled={progress !== null}
      >
        {progress ?? `Stáhnout vybrané (${count})`}
      </Button>
      {result && (
        <p role="status" className="text-caption w-full">
          {result}
        </p>
      )}
    </>
  );
}
