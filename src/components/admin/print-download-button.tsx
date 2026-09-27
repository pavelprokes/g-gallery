"use client";

import { useState } from "react";
import { printDownloadLinks } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

/** Browsers drop downloads started too close together; this spacing is enough for Chrome and Safari. */
const DOWNLOAD_SPACING_MS = 400;

/**
 * Downloads every photo marked for print, one file at a time, each already
 * named for the lab ("5x_…"). The links point at R2 with an attachment
 * disposition, so the page stays put and the bytes never touch Vercel.
 */
export function PrintDownloadButton({ galleryId, count }: { galleryId: string; count: number }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function download() {
    setFailed(false);
    setProgress("Připravuji…");
    try {
      const links = await printDownloadLinks(galleryId);
      for (const [index, link] of links.entries()) {
        setProgress(`Stahuji ${index + 1}/${links.length}`);
        const anchor = document.createElement("a");
        anchor.href = link.url;
        anchor.download = link.name;
        anchor.click();
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_SPACING_MS));
      }
    } catch {
      setFailed(true);
    }
    setProgress(null);
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={download}
      disabled={progress !== null}
    >
      {progress ?? (failed ? "Nepovedlo se, zkusit znovu" : `Stáhnout vybrané (${count})`)}
    </Button>
  );
}
